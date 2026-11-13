import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "./comments";
import { inMemoryNotifications } from "./notifications.fake";
import { createComment, deleteComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  const [first, second] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
  lessonId = first;
  otherLessonId = second;
});

describe("createComment", () => {
  it("stores a trimmed top-level comment stamped with now", () => {
    const { comment } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "  Hello  "
    );
    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "Hello",
      createdAt: NOW.toISOString(),
    });
  });

  it("stores a reply to a top-level comment", () => {
    const { comment: parent } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "Q"
    );
    const { comment: reply } = createComment(
      db,
      NOW,
      base.instructor.id,
      lessonId,
      parent.id,
      "A"
    );
    expect(reply.parentId).toBe(parent.id);
  });

  it("rejects an empty comment", () => {
    expect(() =>
      createComment(db, NOW, base.user.id, lessonId, null, "   ")
    ).toThrow("Comment cannot be empty");
  });

  it("rejects an over-long comment", () => {
    expect(() =>
      createComment(
        db,
        NOW,
        base.user.id,
        lessonId,
        null,
        "a".repeat(MAX_COMMENT_LENGTH + 1)
      )
    ).toThrow(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  });

  it("rejects an unknown lesson", () => {
    expect(() =>
      createComment(db, NOW, base.user.id, 9999, null, "Hi")
    ).toThrow("Lesson not found");
  });

  it("rejects an unknown parent", () => {
    expect(() =>
      createComment(db, NOW, base.user.id, lessonId, 9999, "Hi")
    ).toThrow("Parent comment not found");
  });

  it("rejects a parent from a different lesson", () => {
    const { comment: parent } = createComment(
      db,
      NOW,
      base.user.id,
      otherLessonId,
      null,
      "Q"
    );
    expect(() =>
      createComment(db, NOW, base.user.id, lessonId, parent.id, "Hi")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("rejects a reply to a reply", () => {
    const { comment: parent } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "Q"
    );
    const { comment: reply } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      parent.id,
      "A"
    );
    expect(() =>
      createComment(db, NOW, base.user.id, lessonId, reply.id, "B")
    ).toThrow("Replies can only be one level deep");
  });
});

describe("telling people about Discussion Questions and Replies in the Notification Feed", () => {
  const instructorRecipient = () => ({
    id: base.instructor.id,
    name: "Test Instructor",
    email: "instructor@example.com",
    avatarUrl: null,
  });

  function askQuestion() {
    return createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "Q",
      inMemoryNotifications()
    ).comment;
  }

  function addUser(name: string, role: schema.UserRole) {
    return db
      .insert(schema.users)
      .values({ name, email: `${name}@example.com`, role })
      .returning()
      .get();
  }

  it("notifies the course's Instructor of a Discussion Question with lesson, snippet and comment id", async () => {
    const notifications = inMemoryNotifications();

    const { comment, notified } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "How do I start?",
      notifications
    );
    await notified;

    expect(notifications.triggers).toEqual([
      {
        kind: "discussion-question",
        category: "discussion_questions",
        recipients: [instructorRecipient()],
        actorId: base.user.id,
        idempotencyKey: `discussion-question:${comment.id}`,
        data: {
          commentId: comment.id,
          lessonId,
          lessonTitle: "Lesson 1",
          authorName: "Test User",
          snippet: "How do I start?",
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
    ]);
  });

  it("notifies the Instructor when a Platform Admin asks a Discussion Question", async () => {
    const notifications = inMemoryNotifications();
    const admin = addUser("Ada", schema.UserRole.Admin);

    const { notified } = createComment(
      db,
      NOW,
      admin.id,
      lessonId,
      null,
      "Is this current?",
      notifications
    );
    await notified;

    expect(notifications.triggers.map((t) => t.recipients[0].id)).toEqual([
      base.instructor.id,
    ]);
  });

  it("truncates a long snippet", async () => {
    const notifications = inMemoryNotifications();

    const { notified } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "a".repeat(500),
      notifications
    );
    await notified;

    const snippet = notifications.triggers[0].data.snippet as string;
    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("does not notify the Instructor of their own comment", async () => {
    const notifications = inMemoryNotifications();

    const { notified } = createComment(
      db,
      NOW,
      base.instructor.id,
      lessonId,
      null,
      "Announcement",
      notifications
    );
    await notified;

    expect(notifications.triggers).toEqual([]);
  });

  it("notifies only the question's author of a Discussion Reply", async () => {
    const notifications = inMemoryNotifications();
    const question = askQuestion();

    const { comment: reply, notified } = createComment(
      db,
      NOW,
      base.instructor.id,
      lessonId,
      question.id,
      "Here is the answer",
      notifications
    );
    await notified;

    expect(notifications.triggers).toEqual([
      {
        kind: "discussion-reply",
        category: "discussion_replies",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actorId: base.instructor.id,
        idempotencyKey: `discussion-reply:${reply.id}`,
        data: {
          commentId: reply.id,
          lessonId,
          lessonTitle: "Lesson 1",
          authorName: "Test Instructor",
          snippet: "Here is the answer",
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
    ]);
  });

  it("notifies the question's author of another Student's reply, not the Instructor", async () => {
    const notifications = inMemoryNotifications();
    const question = askQuestion();
    const other = addUser("Sam", schema.UserRole.Student);

    const { notified } = createComment(
      db,
      NOW,
      other.id,
      lessonId,
      question.id,
      "Me too",
      notifications
    );
    await notified;

    expect(notifications.triggers.map((t) => t.recipients[0].id)).toEqual([
      base.user.id,
    ]);
  });

  it("does not notify anyone when the question's author replies to their own question", async () => {
    const notifications = inMemoryNotifications();
    const question = askQuestion();

    const { notified } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      question.id,
      "Never mind, solved",
      notifications
    );
    await notified;

    expect(notifications.triggers).toEqual([]);
  });

  it("still posts the comment when the Notification port fails", async () => {
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { comment, notified } = createComment(
      db,
      NOW,
      base.user.id,
      lessonId,
      null,
      "Hello",
      notifications
    );

    await expect(notified).resolves.toBeUndefined();
    expect(comment.body).toBe("Hello");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("removing Notifications when a comment is deleted", () => {
  const post = (userId: number, parentId: number | null, body: string) =>
    createComment(
      db,
      NOW,
      userId,
      lessonId,
      parentId,
      body,
      inMemoryNotifications()
    ).comment;

  function student() {
    return db
      .insert(schema.users)
      .values({ name: "Other", email: "other@example.com", role: "student" })
      .returning()
      .get();
  }

  it("soft-deletes the comment and archives its Notification", async () => {
    const question = post(base.user.id, null, "Q");
    const notifications = inMemoryNotifications();

    const { comment, notified } = deleteComment(
      db,
      NOW,
      question.id,
      base.user.id,
      false,
      notifications
    );
    await notified;

    expect(comment.deletedAt).toBe(NOW.toISOString());
    expect(notifications.archives).toEqual([question.id]);
  });

  it("archives only the deleted reply, not the question's Notification", async () => {
    const question = post(base.user.id, null, "Q");
    const replier = student();
    const reply = post(replier.id, question.id, "A");
    const notifications = inMemoryNotifications();

    await deleteComment(db, NOW, reply.id, replier.id, false, notifications)
      .notified;

    expect(notifications.archives).toEqual([reply.id]);
  });

  it("leaves Reply Notifications alone when the question is deleted", async () => {
    const question = post(base.user.id, null, "Q");
    const reply = post(student().id, question.id, "A");
    const notifications = inMemoryNotifications();

    await deleteComment(
      db,
      NOW,
      question.id,
      base.user.id,
      false,
      notifications
    ).notified;

    expect(notifications.archives).not.toContain(reply.id);
    expect(notifications.archives).toEqual([question.id]);
  });

  it("lets staff delete someone else's comment", async () => {
    const question = post(base.user.id, null, "Q");
    const notifications = inMemoryNotifications();

    await deleteComment(
      db,
      NOW,
      question.id,
      base.instructor.id,
      true,
      notifications
    ).notified;

    expect(notifications.archives).toEqual([question.id]);
  });

  it("rejects deleting another person's comment and archives nothing", () => {
    const question = post(base.user.id, null, "Q");
    const notifications = inMemoryNotifications();

    expect(() =>
      deleteComment(db, NOW, question.id, student().id, false, notifications)
    ).toThrow("You can only delete your own comments");
    expect(notifications.archives).toEqual([]);
  });

  it("rejects an unknown comment", () => {
    expect(() => deleteComment(db, NOW, 999, base.user.id, false)).toThrow(
      "Comment not found"
    );
  });

  it("does nothing more when the comment is already deleted", async () => {
    const question = post(base.user.id, null, "Q");
    await deleteComment(
      db,
      NOW,
      question.id,
      base.user.id,
      false,
      inMemoryNotifications()
    ).notified;
    const notifications = inMemoryNotifications();

    const { notified } = deleteComment(
      db,
      new Date(NOW.getTime() + 1000),
      question.id,
      base.user.id,
      false,
      notifications
    );
    await notified;

    expect(notifications.archives).toEqual([]);
  });

  it("still deletes the comment when the Notification port fails", async () => {
    const question = post(base.user.id, null, "Q");
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { comment, notified } = deleteComment(
      db,
      NOW,
      question.id,
      base.user.id,
      false,
      notifications
    );

    await expect(notified).resolves.toBeUndefined();
    expect(comment.deletedAt).toBe(NOW.toISOString());
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
