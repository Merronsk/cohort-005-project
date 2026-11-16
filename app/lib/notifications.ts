import { NotificationReason } from "~/db/schema";

// ─── Notification display helpers (client-safe) ───
// The server side (creating, listing, marking read) lives in
// comments.server.ts.

/** The badge text on the bell: nothing at 0, "9+" above nine. */
export function badgeLabel(unreadCount: number): string | null {
  if (unreadCount <= 0) return null;
  return unreadCount > 9 ? "9+" : String(unreadCount);
}

const REASON_PHRASES: Record<NotificationReason, string> = {
  [NotificationReason.CommentOnYourLesson]: "commented on",
  [NotificationReason.ReplyToYourComment]: "replied to your Comment on",
  [NotificationReason.ReplyInYourThread]: "replied in a thread you're in on",
};

/** What happened, as it reads in "**Actor** <phrase> **Lesson**". */
export function reasonPhrase(reason: NotificationReason): string {
  return REASON_PHRASES[reason];
}

/**
 * A Comment body (untrusted Markdown) flattened to one line of plain text for
 * a preview. Render the result as text, never as HTML.
 */
export function previewText(body: string): string {
  return body
    .replace(/```[\s\S]*?(```|$)/g, " ") // fenced code blocks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // block markers
    .replace(/(\*\*|__|\*|_|~~|`)/g, "") // inline emphasis and code
    .replace(/\s+/g, " ")
    .trim();
}
