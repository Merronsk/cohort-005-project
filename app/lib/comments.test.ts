import { describe, expect, it } from "vitest";
import { commentAnchorId, commentIdFromHash } from "./comments";

describe("commentAnchorId", () => {
  it("builds the element id a Comment or Reply is linked by", () => {
    expect(commentAnchorId(42)).toBe("comment-42");
  });
});

describe("commentIdFromHash", () => {
  it("reads the comment id from a matching location hash", () => {
    expect(commentIdFromHash("#comment-42")).toBe(42);
  });

  it("returns null when there is no hash", () => {
    expect(commentIdFromHash("")).toBeNull();
  });

  it("returns null for hashes that are not comment anchors", () => {
    expect(commentIdFromHash("#lesson-notes")).toBeNull();
    expect(commentIdFromHash("#comment-")).toBeNull();
    expect(commentIdFromHash("#comment-12abc")).toBeNull();
    expect(commentIdFromHash("#comment--3")).toBeNull();
  });
});
