import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import { enrollments } from "~/db/schema";
import { inMemoryNotifications } from "./notifications.fake";
import { enrollUser } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("enrollUser", () => {
  it("creates an Enrollment stamped with now", () => {
    const { enrollment } = enrollUser(db, NOW, base.user.id, base.course.id);
    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
      completedAt: null,
    });
  });

  it("refuses a second Enrollment on the same course", () => {
    enrollUser(db, NOW, base.user.id, base.course.id);
    expect(() => enrollUser(db, NOW, base.user.id, base.course.id)).toThrow(
      "User is already enrolled in this course"
    );
  });

  it("refuses an unknown course", () => {
    expect(() => enrollUser(db, NOW, base.user.id, 9999)).toThrow(
      "Course not found"
    );
  });
});

describe("telling the Instructor about an Enrollment in the Notification Feed", () => {
  it("notifies the course's Instructor in the Enrollments category", async () => {
    const notifications = inMemoryNotifications();

    const { enrollment, notified } = enrollUser(
      db,
      NOW,
      base.user.id,
      base.course.id,
      notifications
    );
    await notified;

    expect(notifications.triggers).toEqual([
      {
        kind: "enrollment-created",
        category: "enrollments",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actorId: base.user.id,
        idempotencyKey: `enrollment-created:${enrollment.id}`,
        data: {
          enrollmentId: enrollment.id,
          studentName: "Test User",
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
    ]);
  });

  it("notifies again when a Lapsed Student enrolls again", async () => {
    const notifications = inMemoryNotifications();
    const first = enrollUser(
      db,
      NOW,
      base.user.id,
      base.course.id,
      notifications
    );
    await first.notified;
    db.delete(enrollments).where(eq(enrollments.id, first.enrollment.id)).run();

    const again = enrollUser(
      db,
      NOW,
      base.user.id,
      base.course.id,
      notifications
    );
    await again.notified;

    expect(notifications.triggers).toHaveLength(2);
    expect(notifications.triggers[1].idempotencyKey).toBe(
      `enrollment-created:${again.enrollment.id}`
    );
  });

  it("does not tell an Instructor about their own Enrollment", async () => {
    const notifications = inMemoryNotifications();
    const { notified } = enrollUser(
      db,
      NOW,
      base.instructor.id,
      base.course.id,
      notifications
    );
    await notified;
    expect(notifications.triggers).toEqual([]);
  });

  it("notifies nobody when the Enrollment is refused", () => {
    const notifications = inMemoryNotifications();
    expect(() =>
      enrollUser(db, NOW, base.user.id, 9999, notifications)
    ).toThrow("Course not found");
    expect(notifications.triggers).toEqual([]);
  });

  it("still enrolls when Notifications are failing", async () => {
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const { enrollment, notified } = enrollUser(
      db,
      NOW,
      base.user.id,
      base.course.id,
      notifications
    );
    await expect(notified).resolves.toBeUndefined();
    expect(enrollment.userId).toBe(base.user.id);
  });
});
