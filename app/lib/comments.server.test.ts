import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "./comments";
import { createComment } from "./comments.server";

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
    const comment = createComment(
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
    const parent = createComment(db, NOW, base.user.id, lessonId, null, "Q");
    const reply = createComment(
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
    const parent = createComment(
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
    const parent = createComment(db, NOW, base.user.id, lessonId, null, "Q");
    const reply = createComment(
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
