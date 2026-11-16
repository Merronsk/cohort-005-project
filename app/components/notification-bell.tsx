import { Form, useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  badgeLabel,
  previewText,
  reasonPhrase,
  visibleNotifications,
} from "~/lib/notifications";
import type { NotificationItem } from "~/lib/comments.server";

/** Where the bell's forms post. See `app/routes/api.notifications.ts`. */
export const NOTIFICATIONS_ACTION = "/api/notifications";

export interface BellNotifications {
  unreadCount: number;
  items: NotificationItem[];
}

export function NotificationBell({
  notifications,
}: {
  notifications: BellNotifications;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const markAll = useFetcher();
  // Optimistic: while Mark all read is in flight, show nothing unread.
  const markingAll = markAll.state !== "idle";
  const unreadCount = markingAll ? 0 : notifications.unreadCount;
  const badge = badgeLabel(unreadCount);
  const { shown, earlierCount } = visibleNotifications(
    notifications.items,
    expanded
  );

  // Close on a click outside the bell and its dropdown, or on Escape.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Each opening starts with the shorter list.
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        title="Notifications"
        aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {badge && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            <markAll.Form method="post" action={NOTIFICATIONS_ACTION}>
              <input type="hidden" name="intent" value="mark-all-read" />
              <button
                type="submit"
                disabled={unreadCount === 0}
                className="text-xs text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                Mark all read
              </button>
            </markAll.Form>
          </div>
          {notifications.items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto">
              {shown.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    read={item.read || markingAll}
                    onOpen={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          )}
          {earlierCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full border-t py-2 text-center text-xs text-muted-foreground hover:bg-muted"
            >
              Show {earlierCount} earlier
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Submits mark-read; the action redirects to the lesson at the target.
function NotificationRow({
  item,
  read,
  onOpen,
}: {
  item: NotificationItem;
  read: boolean;
  onOpen: () => void;
}) {
  return (
    <Form method="post" action={NOTIFICATIONS_ACTION} onSubmit={onOpen}>
      <input type="hidden" name="intent" value="mark-read" />
      <input type="hidden" name="notificationId" value={item.id} />
      <button
        type="submit"
        className={cn(
          "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-muted",
          !read && "bg-primary/5"
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {item.actorName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn(read && "text-muted-foreground")}>
            <span className="font-semibold">{item.actorName}</span>{" "}
            {reasonPhrase(item.reason)}{" "}
            <span className="font-semibold">{item.lessonTitle}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            “{previewText(item.preview)}”
          </div>
          <div
            className="mt-0.5 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {formatRelativeTime(item.createdAt)} · {item.courseTitle}
          </div>
        </div>
        {!read && (
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            aria-label="Unread"
          />
        )}
      </button>
    </Form>
  );
}
