import { and, eq } from "drizzle-orm";
import { coupons, courses, enrollments, purchases, users } from "~/db/schema";
import { announceEnrollment } from "~/lib/enrollments.server";
import {
  bestEffort,
  defaultNotifications,
  idempotencyKey,
  notifiable,
  type NotificationPort,
} from "~/lib/notifications.server";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";

// ─── Seat claims ───
// A Student claiming a Seat on a Team Licence (redeeming a coupon code), which
// gives them an Enrollment. Takes the database and the current time so tests
// can hand in an in-memory database and a fixed clock.

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimSeatResult =
  | {
      ok: true;
      enrollment: typeof enrollments.$inferSelect;
      /** Settles once the Notifications are sent or have failed. Never rejects. */
      notified: Promise<void>;
    }
  | { ok: false; error: string };

export function claimSeat(
  db: Db,
  now: Date,
  code: string,
  userId: number,
  userCountry: string,
  notifications?: NotificationPort
): ClaimSeatResult {
  const coupon = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!coupon) {
    return { ok: false, error: "Coupon not found" };
  }

  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, coupon);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  const existingEnrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, coupon.courseId)
      )
    )
    .get();
  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();
  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
    .where(eq(coupons.id, coupon.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({
      userId,
      courseId: coupon.courseId,
      enrolledAt: now.toISOString(),
    })
    .returning()
    .get();

  const notified = Promise.all([
    announceSeatClaim(db, coupon, userId, notifications),
    announceEnrollment(db, enrollment, notifications),
  ]).then(() => undefined);

  return { ok: true, enrollment, notified };
}

/**
 * Tells the Team Admin who owns the Team Licence, in the Notification Feed,
 * who claimed a Seat and how many are left. One per claim. A Team Admin
 * claiming their own Seat is not told. Runs after the claim has committed.
 * Never rejects.
 */
function announceSeatClaim(
  db: Db,
  coupon: typeof coupons.$inferSelect,
  claimerId: number,
  notifications: NotificationPort | undefined
): Promise<void> {
  return bestEffort("Seat claim Notification", async () => {
    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, coupon.purchaseId))
      .get();
    if (!purchase || purchase.userId === claimerId) return;

    const teamAdmin = db
      .select()
      .from(users)
      .where(eq(users.id, purchase.userId))
      .get();
    const claimer = db
      .select()
      .from(users)
      .where(eq(users.id, claimerId))
      .get();
    const course = db
      .select()
      .from(courses)
      .where(eq(courses.id, coupon.courseId))
      .get();
    if (!teamAdmin || !claimer || !course) return;

    const seatsLeft = db
      .select()
      .from(coupons)
      .where(eq(coupons.purchaseId, purchase.id))
      .all()
      .filter(
        (seat) => seat.redeemedByUserId === null && seat.refundedAt === null
      ).length;

    const port = notifications ?? (await defaultNotifications());
    await port.trigger({
      kind: "seat-claimed",
      category: "seat_claims",
      recipients: [notifiable(teamAdmin)],
      actorId: claimer.id,
      idempotencyKey: idempotencyKey("seat-claimed", coupon.id),
      data: {
        couponId: coupon.id,
        purchaseId: purchase.id,
        claimerName: claimer.name,
        courseTitle: course.title,
        courseSlug: course.slug,
        seatsLeft,
      },
    });
  });
}
