import { NotificationReason, UserRole } from "~/db/schema";

// ─── Notification display helpers (client-safe) ───
// The server side (creating, listing, marking read) lives in
// comments.server.ts.

/** The roles that receive Notifications. Platform Admins never do. */
export const NOTIFIABLE_ROLES: readonly UserRole[] = [
  UserRole.Student,
  UserRole.Instructor,
];

/** Whether a user with this role receives Notifications. */
export function canReceiveNotifications(role: UserRole): boolean {
  return NOTIFIABLE_ROLES.includes(role);
}

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

/** How many rows the dropdown shows before "Show N earlier". */
export const NOTIFICATIONS_SHOWN_FIRST = 6;

/**
 * The rows the dropdown shows (newest first) and how many earlier ones the
 * "Show N earlier" link would reveal. Expanded, it shows every row.
 */
export function visibleNotifications<T>(
  items: T[],
  expanded: boolean
): { shown: T[]; earlierCount: number } {
  if (expanded) return { shown: items, earlierCount: 0 };
  return {
    shown: items.slice(0, NOTIFICATIONS_SHOWN_FIRST),
    earlierCount: Math.max(0, items.length - NOTIFICATIONS_SHOWN_FIRST),
  };
}
