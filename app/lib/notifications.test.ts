import { describe, it, expect } from "vitest";
import { NotificationReason } from "~/db/schema";
import {
  badgeLabel,
  previewText,
  reasonPhrase,
  visibleNotifications,
} from "./notifications";

describe("badgeLabel", () => {
  it("shows nothing at 0, the count up to nine, and 9+ above", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
  });
});

describe("reasonPhrase", () => {
  it("words each reason as it reads between the actor and the lesson", () => {
    expect(reasonPhrase(NotificationReason.CommentOnYourLesson)).toBe(
      "commented on"
    );
    expect(reasonPhrase(NotificationReason.ReplyToYourComment)).toBe(
      "replied to your Comment on"
    );
    expect(reasonPhrase(NotificationReason.ReplyInYourThread)).toBe(
      "replied in a thread you're in on"
    );
  });
});

describe("previewText", () => {
  it("flattens Markdown to one line of plain text", () => {
    expect(
      previewText("## Hi\n\nIs **this** [right](http://x.dev)?\n\n`a()` ok")
    ).toBe("Hi Is this right? a() ok");
  });

  it("drops fenced code blocks and keeps HTML as literal text", () => {
    expect(previewText("Look:\n```ts\nconst a = 1;\n```\n<b>bold</b>")).toBe(
      "Look: <b>bold</b>"
    );
  });
});

describe("visibleNotifications", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("shows the newest six and counts the earlier ones", () => {
    expect(visibleNotifications(items, false)).toEqual({
      shown: [1, 2, 3, 4, 5, 6],
      earlierCount: 3,
    });
  });

  it("shows everything once expanded", () => {
    expect(visibleNotifications(items, true)).toEqual({
      shown: items,
      earlierCount: 0,
    });
  });

  it("has nothing earlier when six or fewer exist", () => {
    expect(visibleNotifications([1, 2, 3, 4, 5, 6], false)).toEqual({
      shown: [1, 2, 3, 4, 5, 6],
      earlierCount: 0,
    });
    expect(visibleNotifications([], false)).toEqual({
      shown: [],
      earlierCount: 0,
    });
  });
});
