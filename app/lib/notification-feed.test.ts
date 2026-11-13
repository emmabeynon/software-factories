import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  presentNotification,
  relativeTime,
} from "./notification-feed";

describe("badgeLabel", () => {
  it("shows nothing when there is nothing unseen", () => {
    expect(badgeLabel(0)).toBeNull();
  });
  it("shows the count up to 9 and 9+ beyond", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(250)).toBe("9+");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("reads naturally at each scale", () => {
    expect(relativeTime("2026-11-13T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-13T11:55:00Z", now)).toBe("5m");
    expect(relativeTime("2026-11-13T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-11-10T12:00:00Z", now)).toBe("3d");
  });
});

describe("presentNotification", () => {
  it("presents an approved Refund Request with its decision note and a link to the course", () => {
    const row = presentNotification("refund-approved", {
      courseTitle: "TypeScript Pro",
      courseSlug: "typescript-pro",
      decisionNote: "Happy to help.",
    });
    expect(row).toEqual({
      category: "refund",
      title: "Your Refund Request was approved",
      snippet: "Happy to help.",
      destination: "/courses/typescript-pro",
    });
  });

  it("falls back to the course title when there is no decision note", () => {
    const row = presentNotification("refund-approved", {
      courseTitle: "TypeScript Pro",
      courseSlug: "typescript-pro",
      decisionNote: null,
    });
    expect(row.snippet).toBe("TypeScript Pro");
  });

  it("tells the buyer they can ask again when declined", () => {
    const row = presentNotification("refund-declined", {
      courseTitle: "TypeScript Pro",
      courseSlug: "typescript-pro",
      decisionNote: "Over half completed.",
      canAskAgain: true,
    });
    expect(row.title).toBe("Your Refund Request was declined");
    expect(row.snippet).toBe("Over half completed. You can ask again.");
  });

  it("has nowhere to go for a Refund Request confirmation", () => {
    const row = presentNotification("refund-confirmed", {
      courseTitle: "TypeScript Pro",
    });
    expect(row.destination).toBeNull();
    expect(row.category).toBe("refund");
  });

  it("still renders something for a kind it does not know", () => {
    const row = presentNotification("something-new", {});
    expect(row.title).toBe("New notification");
    expect(row.destination).toBeNull();
  });
});
