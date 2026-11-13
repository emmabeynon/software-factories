import { and, eq } from "drizzle-orm";
import { courses, enrollments, users } from "~/db/schema";
import {
  bestEffort,
  defaultNotifications,
  idempotencyKey,
  notifiable,
  type NotificationPort,
} from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Enrollment ───
// Giving a Student an Enrollment on a course. Takes the database and the
// current time so tests can hand in an in-memory database and a fixed clock.

type Enrollment = typeof enrollments.$inferSelect;

/**
 * Tells the course's Instructor, in the Notification Feed, that a Student
 * enrolled. Runs after the Enrollment has committed. The Enrollments category
 * is off by default, so the vendor only delivers it to Instructors who opted
 * in. An Instructor is never told about their own Enrollment. Never rejects.
 */
export function announceEnrollment(
  db: Db,
  enrollment: Enrollment,
  notifications: NotificationPort | undefined
): Promise<void> {
  return bestEffort("Enrollment Notification", async () => {
    const course = db
      .select()
      .from(courses)
      .where(eq(courses.id, enrollment.courseId))
      .get();
    if (!course || course.instructorId === enrollment.userId) return;

    const instructor = db
      .select()
      .from(users)
      .where(eq(users.id, course.instructorId))
      .get();
    const student = db
      .select()
      .from(users)
      .where(eq(users.id, enrollment.userId))
      .get();
    if (!instructor || !student) return;

    const port = notifications ?? (await defaultNotifications());
    await port.trigger({
      kind: "enrollment-created",
      category: "enrollments",
      recipients: [notifiable(instructor)],
      actorId: student.id,
      idempotencyKey: idempotencyKey("enrollment-created", enrollment.id),
      data: {
        enrollmentId: enrollment.id,
        studentName: student.name,
        courseTitle: course.title,
        courseSlug: course.slug,
      },
    });
  });
}

/**
 * `notified` settles once the Instructor's Notification has been sent or has
 * failed. It never rejects: a failing Notification never fails the Enrollment.
 */
export function enrollUser(
  db: Db,
  now: Date,
  userId: number,
  courseId: number,
  notifications?: NotificationPort
): { enrollment: Enrollment; notified: Promise<void> } {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
  if (existing) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    throw new Error("Course not found");
  }

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();

  return {
    enrollment,
    notified: announceEnrollment(db, enrollment, notifications),
  };
}
