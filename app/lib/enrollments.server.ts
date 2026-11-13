import { and, eq } from "drizzle-orm";
import { courses, enrollments } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";

// ─── Enrollment ───
// Giving a Student an Enrollment on a course. Takes the database and the
// current time so tests can hand in an in-memory database and a fixed clock.

export function enrollUser(
  db: Db,
  now: Date,
  userId: number,
  courseId: number
) {
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

  return db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();
}
