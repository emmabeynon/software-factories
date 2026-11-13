import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";

// ─── Comments ───
// Posting a comment or reply on a lesson. Used by both the lesson route and
// the Instructor questions route. Takes the database and the current time so
// tests can hand in an in-memory database and a fixed clock.

export function assertValidCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export function createComment(
  db: Db,
  now: Date,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
) {
  const trimmed = assertValidCommentBody(body);

  const course = db
    .select({ courseId: courses.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = db
      .select()
      .from(comments)
      .where(eq(comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({
      userId,
      lessonId,
      parentId,
      body: trimmed,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();
}
