import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, RefundStatus, UserRole } from "~/db/schema";
import {
  approveRefundRequest,
  checkRefundRequest,
  declineRefundRequest,
  getRefundOffer,
  getSeatAvailability,
  listRefundRequestsForBuyer,
  listRefundRequestsForReview,
  listTeamLicences,
  raiseRefundRequest,
} from "./refunds.server";
import { inMemoryNotifications } from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addLearner(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buyForSelf(userId: number, daysAgo = 3, amountPaid = 7900) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(userId: number, seats: number, daysAgo = 3) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function claimSeat(seatId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: daysBefore(1) })
    .where(eq(schema.coupons.id, seatId))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function isEnrolled(userId: number) {
  return !!db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .get();
}

function raise(purchaseId: number, buyerId: number) {
  const result = raiseRefundRequest(
    db,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}

function getSeat(seatId: number) {
  const seat = db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
  if (!seat) throw new Error("Seat not found");
  return seat;
}

describe("raising a Refund Request", () => {
  it("lets the buyer raise one on an Individual Purchase inside the window", () => {
    const purchase = buyForSelf(base.user.id);

    const result = raiseRefundRequest(db, purchase.id, base.user.id, "Nope.", NOW);

    expect(result).toMatchObject({ ok: true, kind: "individual_purchase" });
  });

  it("refuses anyone but the buyer", () => {
    const purchase = buyForSelf(base.user.id);
    const someoneElse = addLearner("Ben");

    expect(checkRefundRequest(db, purchase.id, someoneElse.id, NOW)).toMatchObject(
      { ok: false, status: 404 }
    );
  });

  it("allows only one Open Refund Request per Purchase", () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 409 }
    );
  });

  it("keeps the fourteenth day open and closes the fifteenth", () => {
    const onDay14 = buyForSelf(base.user.id, 14);
    const onDay15 = buyForSelf(addLearner("Ben").id, 15);

    expect(checkRefundRequest(db, onDay14.id, onDay14.userId, NOW).ok).toBe(true);
    expect(
      checkRefundRequest(db, onDay15.id, onDay15.userId, NOW)
    ).toMatchObject({ ok: false, error: "The 14-day window has closed." });
  });

  it("refuses a buyer who has completed half the lessons", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a buyer who has watched two hours", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.videoWatchEvents)
      .values([
        { userId: base.user.id, lessonId: lessonIds[0], eventType: "progress", positionSeconds: 3600 },
        { userId: base.user.id, lessonId: lessonIds[1], eventType: "progress", positionSeconds: 3600 },
      ])
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a Team Licence with a Claimed Seat", () => {
    const teamAdmin = addLearner("Priya");
    const { purchase, seats } = buySeats(teamAdmin.id, 3);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(checkRefundRequest(db, purchase.id, teamAdmin.id, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("the refund offer on the course page", () => {
  it("offers the newest Individual Purchase, not a newer Team Licence", () => {
    const individual = buyForSelf(base.user.id, 3);
    buySeats(base.user.id, 5, 1);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toMatchObject({
      purchaseId: individual.id,
      amount: 7900,
    });
  });

  it("offers nothing once the purchase has been refunded", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toBeNull();
  });
});

describe("approving a Refund Request", () => {
  it("removes the buyer's Enrollment but keeps their progress", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        status: LessonProgressStatus.Completed,
      })
      .run();
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(
      db
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.userId, base.user.id))
        .all()
    ).toHaveLength(1);

    const refundRequest = db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .get();
    expect(refundRequest).toMatchObject({
      status: RefundStatus.Approved,
      amountRefunded: 7900,
      resolvedByUserId: platformAdmin.id,
    });
  });

  it("keeps the buyer's Enrollment if they also hold a Claimed Seat for the course", () => {
    const priya = addLearner("Priya");
    const { seats } = buySeats(priya.id, 2);
    // Liam claims a Seat first, so his Enrollment came from it.
    claimSeat(seats[0].id, base.user.id);
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: daysBefore(2),
      })
      .returning()
      .get();
    const id = raise(purchase.id, base.user.id);

    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(isEnrolled(base.user.id)).toBe(true);
  });

  it("makes a Team Licence's Unclaimed Seats unclaimable", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    for (const seat of seats) {
      expect(getSeatAvailability(db, getSeat(seat.id))).toBe("refunded");
    }
  });

  it("refuses a Team Licence whose Seat was claimed after the request", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);
    // Seats are on hold while Open, but older data can still hold a claim.
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(approveRefundRequest(db, id, platformAdmin.id, null, NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(getSeatAvailability(db, getSeat(seats[1].id))).toBe("on_hold");
  });

  it("lets the first decision win", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(
      declineRefundRequest(db, id, platformAdmin.id, "Too late.", NOW)
    ).toMatchObject({
      ok: false,
      status: 409,
      error: "This refund request was already approved.",
    });
  });

  it("emails the buyer that the refund is on its way", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    if (!result.ok) throw new Error(result.error);
    expect(result.email.to).toBe("test@example.com");
    expect(result.email.subject).toBe("Refund approved — Test Course");
    expect(result.email.body).toContain("$79.00");
  });
});

describe("declining a Refund Request", () => {
  it("needs a note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    expect(declineRefundRequest(db, id, platformAdmin.id, "  ", NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("keeps the buyer's Enrollment and lets them raise a new Refund Request", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = declineRefundRequest(
      db,
      id,
      platformAdmin.id,
      "You finished the course.",
      NOW
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.email.body).toContain("You finished the course.");
    expect(isEnrolled(base.user.id)).toBe(true);
    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW).ok).toBe(true);
  });

  it("frees a Team Licence's Seats again", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 1);
    const id = raise(purchase.id, priya.id);
    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("on_hold");

    declineRefundRequest(db, id, platformAdmin.id, "Seats are in use.", NOW);

    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("available");
  });
});

describe("listing Refund Requests", () => {
  it("shows a Platform Admin live figures and the rules a request breaks", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    // Since raising the request, the buyer has finished half the course.
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row).toMatchObject({
      id,
      buyerName: "Test User",
      daysSincePurchase: 3,
      figures: {
        kind: "individual_purchase",
        lessonsCompleted: 2,
        lessonCount: 4,
      },
      ruleBreaks: ["completed_too_much"],
      canApprove: true,
    });
  });

  it("shows a Team Licence's Seats instead of the buyer's progress", () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 3);
    raise(purchase.id, priya.id);

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row.figures).toEqual({
      kind: "team_licence",
      seatCount: 3,
      claimedSeatCount: 0,
    });
  });

  it("lists only the requested status, oldest first", () => {
    const first = buyForSelf(base.user.id);
    const ben = addLearner("Ben");
    const second = buyForSelf(ben.id);
    const firstId = raise(first.id, base.user.id);
    const secondId = raiseRefundRequest(
      db,
      second.id,
      ben.id,
      "Changed my mind.",
      new Date(NOW.getTime() + 60_000)
    );
    if (!secondId.ok) throw new Error(secondId.error);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Open, NOW).map((r) => r.id)
    ).toEqual([firstId, secondId.refundRequestId]);

    approveRefundRequest(db, firstId, platformAdmin.id, null, NOW);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Approved, NOW)
    ).toMatchObject([{ id: firstId, decidedByName: "Pat Admin" }]);
  });

  it("shows a buyer their decided requests with the decline note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    declineRefundRequest(db, id, platformAdmin.id, "Past half way.", NOW);

    expect(listRefundRequestsForBuyer(db, base.user.id)).toMatchObject([
      { id, status: RefundStatus.Declined, decisionNote: "Past half way." },
    ]);
  });

  it("lists a Team Admin's Team Licences and whether each can be refunded", () => {
    const priya = addLearner("Priya");
    buySeats(priya.id, 2);
    const { seats } = buySeats(priya.id, 2);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(listTeamLicences(db, priya.id, NOW)).toMatchObject([
      { seatCount: 2, claimedSeatCount: 1, canRequestRefund: false },
      { seatCount: 2, claimedSeatCount: 0, canRequestRefund: true },
    ]);
  });
});

describe("telling the buyer about a decision in the Notification Feed", () => {
  it("notifies the buyer when a Refund Request is approved", async () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    const notifications = inMemoryNotifications();

    const result = approveRefundRequest(
      db,
      id,
      platformAdmin.id,
      "Sorry it was not for you.",
      NOW,
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    await result.notified;

    expect(notifications.triggers).toEqual([
      {
        kind: "refund-approved",
        category: "refund_request_updates",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actorId: platformAdmin.id,
        idempotencyKey: `refund-approved:${id}`,
        data: {
          refundRequestId: id,
          purchaseId: purchase.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          amountPaid: 7900,
          decisionNote: "Sorry it was not for you.",
        },
      },
    ]);
  });

  it("notifies the buyer when a Refund Request is declined, and says they can ask again", async () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    const notifications = inMemoryNotifications();

    const result = declineRefundRequest(
      db,
      id,
      platformAdmin.id,
      "You finished the course.",
      NOW,
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    await result.notified;

    expect(notifications.triggers).toHaveLength(1);
    expect(notifications.triggers[0]).toMatchObject({
      kind: "refund-declined",
      category: "refund_request_updates",
      recipients: [{ id: base.user.id }],
      idempotencyKey: `refund-declined:${id}`,
      data: {
        purchaseId: purchase.id,
        courseTitle: "Test Course",
        decisionNote: "You finished the course.",
        canAskAgain: true,
      },
    });
  });

  it("notifies nobody when the decision fails", async () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    declineRefundRequest(db, id, platformAdmin.id, "No.", NOW);
    const notifications = inMemoryNotifications();

    const result = approveRefundRequest(
      db,
      id,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );

    expect(result.ok).toBe(false);
    expect(notifications.triggers).toEqual([]);
  });

  it("still approves and declines when the port throws", async () => {
    const first = buyForSelf(base.user.id);
    const approveId = raise(first.id, base.user.id);
    const other = addLearner("Priya");
    const second = buyForSelf(other.id);
    const declineId = raise(second.id, other.id);
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const approved = approveRefundRequest(
      db,
      approveId,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );
    const declined = declineRefundRequest(
      db,
      declineId,
      platformAdmin.id,
      "No.",
      NOW,
      notifications
    );
    if (!approved.ok || !declined.ok) throw new Error("expected success");
    await expect(approved.notified).resolves.toBeUndefined();
    await expect(declined.notified).resolves.toBeUndefined();

    expect(isEnrolled(base.user.id)).toBe(false);
    expect(isEnrolled(other.id)).toBe(true);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("telling people about a new Refund Request in the Notification Feed", () => {
  function raiseWith(
    notifications: ReturnType<typeof inMemoryNotifications>,
    purchaseId: number,
    buyerId: number
  ) {
    const result = raiseRefundRequest(
      db,
      purchaseId,
      buyerId,
      "It was not what I expected.",
      NOW,
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  it("confirms to the buyer that the request is under review, even though they caused it", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifications = inMemoryNotifications();

    const result = raiseWith(notifications, purchase.id, base.user.id);
    await result.notified;

    expect(
      notifications.triggers.filter((t) => t.kind === "refund-confirmed")
    ).toEqual([
      {
        kind: "refund-confirmed",
        category: "refund_request_updates",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actorId: null,
        idempotencyKey: `refund-confirmed:${result.refundRequestId}`,
        data: {
          refundRequestId: result.refundRequestId,
          purchaseId: purchase.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          amountPaid: 7900,
        },
      },
    ]);
  });

  it("alerts every current Platform Admin, with who asked, the course, amount and reason", async () => {
    const purchase = buyForSelf(base.user.id);
    const otherAdmin = db
      .insert(schema.users)
      .values({ name: "Ada Admin", email: "ada@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const notifications = inMemoryNotifications();

    const result = raiseWith(notifications, purchase.id, base.user.id);
    await result.notified;

    const alerts = notifications.triggers.filter(
      (t) => t.kind === "refund-requested"
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      category: "open_refund_requests",
      actorId: base.user.id,
      idempotencyKey: `refund-requested:${result.refundRequestId}`,
      data: {
        refundRequestId: result.refundRequestId,
        purchaseId: purchase.id,
        buyerName: "Test User",
        courseTitle: "Test Course",
        courseSlug: "test-course",
        amountPaid: 7900,
        reason: "It was not what I expected.",
      },
    });
    expect(alerts[0].recipients.map((r) => r.id).sort()).toEqual(
      [platformAdmin.id, otherAdmin.id].sort()
    );
  });

  it("includes a newly promoted admin for later requests only", async () => {
    const first = buyForSelf(base.user.id);
    const notifications = inMemoryNotifications();
    const firstResult = raiseWith(notifications, first.id, base.user.id);
    await firstResult.notified;

    const promoted = addLearner("Pia");
    db.update(schema.users)
      .set({ role: UserRole.Admin })
      .where(eq(schema.users.id, promoted.id))
      .run();

    const second = buyForSelf(promoted.id);
    const secondResult = raiseWith(notifications, second.id, promoted.id);
    await secondResult.notified;

    const [early, later] = notifications.triggers.filter(
      (t) => t.kind === "refund-requested"
    );
    expect(early.recipients.map((r) => r.id)).not.toContain(promoted.id);
    expect(later.recipients.map((r) => r.id)).toContain(promoted.id);
  });

  it("does not remove other admins' Notifications when one admin decides", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifications = inMemoryNotifications();
    const raised = raiseWith(notifications, purchase.id, base.user.id);
    await raised.notified;

    const decided = approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );
    if (!decided.ok) throw new Error(decided.error);
    await decided.notified;

    expect(notifications.archives).toEqual([]);
  });

  it("never fails raising the request when delivery fails", async () => {
    const purchase = buyForSelf(base.user.id);
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = raiseWith(notifications, purchase.id, base.user.id);

    await expect(result.notified).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
