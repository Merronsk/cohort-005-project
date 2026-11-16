export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

const COMMENT_ANCHOR_PREFIX = "comment-";

/** Element id a Comment or Reply is linked by, e.g. `/lessons/3#comment-42`. */
export function commentAnchorId(commentId: number): string {
  return `${COMMENT_ANCHOR_PREFIX}${commentId}`;
}

/** The comment id in a `#comment-<id>` location hash, or null if it isn't one. */
export function commentIdFromHash(hash: string): number | null {
  const match = /^#comment-(\d+)$/.exec(hash);
  return match ? Number(match[1]) : null;
}
