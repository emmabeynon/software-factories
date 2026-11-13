import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import {
  bestEffort,
  defaultNotifications,
  idempotencyKey,
  notifiable,
  type NotificationPort,
} from "~/lib/notifications.server";
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

const SNIPPET_LENGTH = 140;

function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_LENGTH
    ? flat.slice(0, SNIPPET_LENGTH - 1).trimEnd() + "…"
    : flat;
}

type Comment = typeof comments.$inferSelect;

/**
 * Tells one person, in the Notification Feed, about a comment: the course's
 * Instructor for a Discussion Question (unless they wrote it), or the
 * question's author for a Discussion Reply (unless they wrote it). Runs after
 * the comment has committed. Never rejects.
 */
function announceComment(
  db: Db,
  comment: Comment,
  notifications: NotificationPort | undefined
): Promise<void> {
  return bestEffort("Discussion Notification", async () => {
    const context = db
      .select({ course: courses, lessonTitle: lessons.title })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, comment.lessonId))
      .get();
    if (!context) return;
    const { course, lessonTitle } = context;

    const { parentId } = comment;
    const isReply = parentId !== null;
    let recipientId = course.instructorId;
    if (parentId !== null) {
      const question = db
        .select()
        .from(comments)
        .where(eq(comments.id, parentId))
        .get();
      if (!question) return;
      recipientId = question.userId;
    }
    if (recipientId === comment.userId) return;

    const recipient = db
      .select()
      .from(users)
      .where(eq(users.id, recipientId))
      .get();
    const author = db
      .select()
      .from(users)
      .where(eq(users.id, comment.userId))
      .get();
    if (!recipient || !author) return;

    const kind = isReply ? "discussion-reply" : "discussion-question";
    const port = notifications ?? (await defaultNotifications());
    await port.trigger({
      kind,
      category: isReply ? "discussion_replies" : "discussion_questions",
      recipients: [notifiable(recipient)],
      actorId: author.id,
      idempotencyKey: idempotencyKey(kind, comment.id),
      data: {
        commentId: comment.id,
        lessonId: comment.lessonId,
        lessonTitle,
        authorName: author.name,
        snippet: snippetOf(comment.body),
        courseTitle: course.title,
        courseSlug: course.slug,
      },
    });
  });
}

/**
 * `notified` settles once the Notification has been sent or has failed. It
 * never rejects: a failing Notification never fails posting.
 */
export function createComment(
  db: Db,
  now: Date,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  notifications?: NotificationPort
): { comment: Comment; notified: Promise<void> } {
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

  const comment = db
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

  return { comment, notified: announceComment(db, comment, notifications) };
}

/**
 * Soft-deletes a comment and, after that has committed, archives the
 * Notifications it caused. Deleting a Discussion Question archives only the
 * question's own Notification: Reply Notifications carry their own comment id
 * and stay. `notified` never rejects.
 */
export function deleteComment(
  db: Db,
  now: Date,
  commentId: number,
  userId: number,
  isStaff: boolean,
  notifications?: NotificationPort
): { comment: Comment; notified: Promise<void> } {
  const existing = db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return { comment: existing, notified: Promise.resolve() };
  }

  const comment = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  const notified = bestEffort(
    "archive of Discussion Notifications",
    async () => {
      const port = notifications ?? (await defaultNotifications());
      await port.archiveForComment(comment.id);
    }
  );
  return { comment, notified };
}
