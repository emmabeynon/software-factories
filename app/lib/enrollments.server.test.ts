import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
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
    const enrollment = enrollUser(db, NOW, base.user.id, base.course.id);
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
