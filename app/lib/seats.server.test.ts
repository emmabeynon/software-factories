import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { inMemoryNotifications } from "./notifications.fake";
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

describe("telling people about a claim in the Notification Feed", () => {
  // The Team Admin is a Student who bought a Team Licence of three Seats.
  let teamAdmin: typeof schema.users.$inferSelect;
  let seats: (typeof schema.coupons.$inferSelect)[];

  beforeEach(() => {
    teamAdmin = db
      .insert(schema.users)
      .values({
        name: "Tara Admin",
        email: "tara@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const team = db.insert(schema.teams).values({}).returning().get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: teamAdmin.id,
        courseId: base.course.id,
        amountPaid: 3000,
        country: "US",
      })
      .returning()
      .get();
    seats = ["A", "B", "C"].map((suffix) =>
      db
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "TEAM" + suffix,
          purchaseId: purchase.id,
        })
        .returning()
        .get()
    );
  });

  function claim(
    notifications: ReturnType<typeof inMemoryNotifications>,
    code: string,
    userId: number
  ) {
    const result = claimSeat(db, NOW, code, userId, "US", notifications);
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  it("tells the Team Admin who claimed, which course, and Seats left", async () => {
    const notifications = inMemoryNotifications();
    await claim(notifications, "TEAMA", base.user.id).notified;

    expect(
      notifications.triggers.filter((t) => t.kind === "seat-claimed")
    ).toEqual([
      {
        kind: "seat-claimed",
        category: "seat_claims",
        recipients: [
          {
            id: teamAdmin.id,
            name: "Tara Admin",
            email: "tara@example.com",
            avatarUrl: null,
          },
        ],
        actorId: base.user.id,
        idempotencyKey: `seat-claimed:${seats[0].id}`,
        data: {
          couponId: seats[0].id,
          purchaseId: seats[0].purchaseId,
          claimerName: "Test User",
          courseTitle: "Test Course",
          courseSlug: "test-course",
          seatsLeft: 2,
        },
      },
    ]);
  });

  it("sends one Notification per claim, and no special one for the last Seat", async () => {
    const notifications = inMemoryNotifications();
    const students = ["Ann", "Bo", "Cy"].map((name) =>
      db
        .insert(schema.users)
        .values({
          name,
          email: `${name}@example.com`,
          role: schema.UserRole.Student,
        })
        .returning()
        .get()
    );
    for (const [i, code] of ["TEAMA", "TEAMB", "TEAMC"].entries()) {
      await claim(notifications, code, students[i].id).notified;
    }

    const seatClaims = notifications.triggers.filter(
      (t) => t.kind === "seat-claimed"
    );
    expect(seatClaims.map((t) => t.data.seatsLeft)).toEqual([2, 1, 0]);
  });

  it("also tells the Instructor, in the Enrollments category, of the new Enrollment", async () => {
    const notifications = inMemoryNotifications();
    const result = claim(notifications, "TEAMA", base.user.id);
    await result.notified;

    const enrolled = notifications.triggers.filter(
      (t) => t.kind === "enrollment-created"
    );
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0]).toMatchObject({
      category: "enrollments",
      recipients: [{ id: base.instructor.id }],
      actorId: base.user.id,
      idempotencyKey: `enrollment-created:${result.enrollment.id}`,
    });
  });

  it("does not tell a Team Admin about their own claim", async () => {
    const notifications = inMemoryNotifications();
    await claim(notifications, "TEAMA", teamAdmin.id).notified;

    expect(
      notifications.triggers.filter((t) => t.kind === "seat-claimed")
    ).toEqual([]);
  });

  it("notifies nobody when the claim is refused", () => {
    const notifications = inMemoryNotifications();
    const result = claimSeat(
      db,
      NOW,
      "NOPE",
      base.user.id,
      "US",
      notifications
    );
    expect(result.ok).toBe(false);
    expect(notifications.triggers).toEqual([]);
  });

  it("still claims the Seat when Notifications are failing", async () => {
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const result = claim(notifications, "TEAMA", base.user.id);
    await expect(result.notified).resolves.toBeUndefined();
  });
});
