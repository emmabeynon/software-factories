import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { claimSeat } from "./seats.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let seat: typeof schema.coupons.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: base.instructor.id,
      courseId: base.course.id,
      amountPaid: 1000,
      country: "US",
    })
    .returning()
    .get();
  seat = db
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code: "SEAT1",
      purchaseId: purchase.id,
    })
    .returning()
    .get();
});

describe("claimSeat", () => {
  it("marks the Seat claimed and enrolls the Student", () => {
    const result = claimSeat(db, NOW, "SEAT1", base.user.id, "US");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    const claimed = db
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.id, seat.id))
      .get();
    expect(claimed).toMatchObject({
      redeemedByUserId: base.user.id,
      redeemedAt: NOW.toISOString(),
    });
  });

  it("rejects an unknown code", () => {
    expect(claimSeat(db, NOW, "NOPE", base.user.id, "US")).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("rejects a Seat that is already claimed", () => {
    claimSeat(db, NOW, "SEAT1", base.user.id, "US");
    expect(claimSeat(db, NOW, "SEAT1", base.user.id, "US")).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("rejects a refunded Seat", () => {
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, seat.id))
      .run();
    const result = claimSeat(db, NOW, "SEAT1", base.user.id, "US");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no longer available");
  });

  it("rejects a Student who is already enrolled", () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    expect(claimSeat(db, NOW, "SEAT1", base.user.id, "US")).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
  });

  it("rejects a claim from a different country to the purchase", () => {
    expect(claimSeat(db, NOW, "SEAT1", base.user.id, "GB")).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });
});
