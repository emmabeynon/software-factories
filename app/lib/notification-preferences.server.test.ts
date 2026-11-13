import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { inMemoryNotifications } from "./notifications.fake";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notifications.server";
import {
  getNotificationPreferenceSwitches,
  setNotificationPreference,
} from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

async function visible(userId: number) {
  const switches = await getNotificationPreferenceSwitches(
    db,
    inMemoryNotifications(),
    userId
  );
  return switches.map((s) => s.category);
}

function newUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

describe("which switches a person sees", () => {
  it("shows only Discussion Replies to someone with nothing else", async () => {
    const user = newUser("fresh", schema.UserRole.Student);
    expect(await visible(user.id)).toEqual(["discussion_replies"]);
  });

  it("shows Refund Request updates once they have a Purchase, whatever their role", async () => {
    db.insert(schema.purchases)
      .values({
        userId: base.instructor.id,
        courseId: base.course.id,
        amountPaid: 1000,
      })
      .run();
    expect(await visible(base.instructor.id)).toContain(
      "refund_request_updates"
    );
    expect(await visible(base.user.id)).not.toContain(
      "refund_request_updates"
    );
  });

  it("shows Seat claims to a Team Admin, not to a plain Team member", async () => {
    const team = db.insert(schema.teams).values({}).returning().get();
    const member = newUser("member", schema.UserRole.Student);
    db.insert(schema.teamMembers)
      .values([
        {
          teamId: team.id,
          userId: base.user.id,
          role: schema.TeamMemberRole.Admin,
        },
        {
          teamId: team.id,
          userId: member.id,
          role: schema.TeamMemberRole.Member,
        },
      ])
      .run();
    expect(await visible(base.user.id)).toContain("seat_claims");
    expect(await visible(member.id)).not.toContain("seat_claims");
  });

  it("shows Enrollments and Discussion Questions to an Instructor only", async () => {
    expect(await visible(base.instructor.id)).toEqual(
      expect.arrayContaining(["enrollments", "discussion_questions"])
    );
    const shown = await visible(base.user.id);
    expect(shown).not.toContain("enrollments");
    expect(shown).not.toContain("discussion_questions");
  });

  it("shows Open Refund Requests to a Platform Admin only", async () => {
    const admin = newUser("admin", schema.UserRole.Admin);
    expect(await visible(admin.id)).toContain("open_refund_requests");
    expect(await visible(base.user.id)).not.toContain("open_refund_requests");
  });

  it("reports each switch's saved value, defaulting when nothing is saved", async () => {
    const notifications = inMemoryNotifications();
    await notifications.setPreferences(base.instructor.id, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enrollments: true,
      discussion_replies: false,
    });
    const saved = await getNotificationPreferenceSwitches(
      db,
      notifications,
      base.instructor.id
    );
    expect(saved.find((s) => s.category === "enrollments")?.enabled).toBe(true);
    expect(saved.find((s) => s.category === "discussion_replies")?.enabled).toBe(
      false
    );

    const fresh = await getNotificationPreferenceSwitches(
      db,
      inMemoryNotifications(),
      base.instructor.id
    );
    expect(fresh.find((s) => s.category === "enrollments")?.enabled).toBe(
      false
    );
    expect(
      fresh.find((s) => s.category === "discussion_questions")?.enabled
    ).toBe(true);
  });
});

describe("flipping a switch", () => {
  it("changes only that category and keeps the rest", async () => {
    const notifications = inMemoryNotifications();
    await notifications.setPreferences(7, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      seat_claims: false,
      enrollments: true,
    });

    await setNotificationPreference(
      notifications,
      7,
      "discussion_replies",
      false
    );

    expect(await notifications.getPreferences(7)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      seat_claims: false,
      enrollments: true,
      discussion_replies: false,
    });
  });

  it("starts from the defaults when the person has no saved set", async () => {
    const notifications = inMemoryNotifications();
    await setNotificationPreference(notifications, 7, "enrollments", true);
    expect(await notifications.getPreferences(7)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enrollments: true,
    });
  });

  it("throws when the save fails, so the caller can revert", async () => {
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("knock down"));
    await expect(
      setNotificationPreference(notifications, 7, "seat_claims", false)
    ).rejects.toThrow("knock down");
  });
});
