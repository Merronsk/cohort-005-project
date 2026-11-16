// PROTOTYPE — throwaway. Three structurally different Notification UIs,
// mounted in the real app layout and switched with ?variant=A|B|C.
//
//   A  Bell + popover       bell in the sidebar's top strip, numeric badge,
//                           flat chronological dropdown, one row per Notification
//   B  Nav item + drawer    "Notifications" sidebar entry with count pill,
//                           right slide-over, rows collapsed per thread, Unread/All tabs
//   C  Bell dot + inbox     bell with a dot (no number), opens a two-pane inbox
//                           in the main area, grouped by lesson, read-on-view
//
// State lives in memory only (reload resets it). Clicking marks read and
// navigates to the lesson with a #comment-<id> hash (no anchors exist yet).
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bell, Check, CheckCheck, ExternalLink, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { ago, badge, sentence, type ProtoNotification } from "./types";

export const VARIANTS = [
  { key: "A", name: "Bell + popover, flat" },
  { key: "B", name: "Nav item + grouped drawer" },
  { key: "C", name: "Bell dot + inbox page" },
];

export function useProtoNotifications(initial: ProtoNotification[]) {
  const [items, setItems] = useState(initial);
  const navigate = useNavigate();
  const unread = items.filter((n) => !n.read).length;
  const markRead = (ids: number[]) =>
    setItems((xs) => xs.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
  const markAllRead = () => setItems((xs) => xs.map((n) => ({ ...n, read: true })));
  const open = (ids: number[], href: string) => {
    markRead(ids);
    navigate(href);
  };
  return { items, unread, markRead, markAllRead, open };
}
export type ProtoState = ReturnType<typeof useProtoNotifications>;

function Initial({ name }: { name: string }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
      {name.slice(0, 1)}
    </div>
  );
}

function Line({ n }: { n: ProtoNotification }) {
  const s = sentence(n);
  return (
    <span>
      <span className="font-semibold">{s.who}</span> {s.what}{" "}
      <span className="font-semibold">{n.lessonTitle}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- A */

export function VariantATrigger({ state }: { state: ProtoState }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const shown = showAll ? state.items : state.items.slice(0, 6);

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        title="Notifications"
      >
        <Bell className="size-5" />
        {state.unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {badge(state.unread)}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            <button
              onClick={state.markAllRead}
              disabled={state.unread === 0}
              className="text-xs text-primary hover:underline disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          {state.items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto">
              {shown.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      state.open([n.id], n.href);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-muted",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <Initial name={n.actorName} />
                    <div className="min-w-0 flex-1">
                      <div className={cn(n.read && "text-muted-foreground")}>
                        <Line n={n} />
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        “{n.snippet}”
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {ago(n.minutesAgo)} · {n.courseTitle}
                      </div>
                    </div>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!showAll && state.items.length > 6 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full border-t py-2 text-center text-xs text-muted-foreground hover:bg-muted"
            >
              Show {state.items.length - 6} earlier
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- B */

interface Group {
  key: string;
  items: ProtoNotification[];
}

function groupByThread(items: ProtoNotification[]): Group[] {
  const map = new Map<string, ProtoNotification[]>();
  for (const n of items) {
    // A new Comment on your lesson is its own thread start; Replies collapse per thread+reason.
    const key = n.kind === "comment-on-your-lesson" ? `c${n.id}` : `${n.kind}:${n.threadId}`;
    map.set(key, [...(map.get(key) ?? []), n]);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}

function groupSentence(g: Group) {
  const names = [...new Set(g.items.map((n) => n.actorName))];
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length > 3 ? "s" : ""}`;
  return { who, what: sentence(g.items[0]).what };
}

export function VariantBNavItem({ state }: { state: ProtoState }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const groups = useMemo(() => {
    const src = tab === "unread" ? state.items.filter((n) => !n.read) : state.items;
    return groupByThread(src);
  }, [state.items, tab]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        Notifications
        {state.unread > 0 && (
          <span className="ml-auto rounded-full bg-primary px-2 text-xs font-semibold leading-5 text-primary-foreground">
            {badge(state.unread)}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[28rem] flex-col bg-background shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Notifications</h2>
              <button
                onClick={state.markAllRead}
                disabled={state.unread === 0}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex gap-1 border-b px-5 py-2 text-sm">
              {(["unread", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-3 py-1 capitalize",
                    tab === t ? "bg-muted font-semibold" : "text-muted-foreground"
                  )}
                >
                  {t} {t === "unread" && `(${state.unread})`}
                </button>
              ))}
            </div>
            <ul className="flex-1 divide-y overflow-y-auto">
              {groups.length === 0 && (
                <li className="p-10 text-center text-sm text-muted-foreground">
                  Nothing unread. <button className="underline" onClick={() => setTab("all")}>See all</button>
                </li>
              )}
              {groups.map((g) => {
                const latest = g.items[0];
                const anyUnread = g.items.some((n) => !n.read);
                const s = groupSentence(g);
                const ids = g.items.map((n) => n.id);
                return (
                  <li key={g.key} className="group relative">
                    <button
                      onClick={() => {
                        setOpen(false);
                        state.open(ids, latest.href);
                      }}
                      className="w-full px-5 py-4 text-left text-sm hover:bg-muted"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {anyUnread && <span className="size-2 rounded-full bg-primary" />}
                        {latest.courseTitle} · {ago(latest.minutesAgo)}
                        {g.items.length > 1 && (
                          <span className="rounded bg-muted px-1.5 font-semibold">{g.items.length}</span>
                        )}
                      </div>
                      <div className={cn("mt-1", !anyUnread && "text-muted-foreground")}>
                        <span className="font-semibold">{s.who}</span> {s.what}{" "}
                        <span className="font-semibold">{latest.lessonTitle}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 border-l-2 pl-2 text-muted-foreground">
                        {latest.snippet}
                      </div>
                    </button>
                    {anyUnread && (
                      <button
                        title="Mark read"
                        onClick={() => state.markRead(ids)}
                        className="absolute right-4 top-4 hidden rounded-md border bg-background p-1 group-hover:block"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- C */

export function VariantCTrigger({ state }: { state: ProtoState }) {
  const [params, setParams] = useSearchParams();
  const active = params.get("inbox") === "1";
  return (
    <button
      onClick={() => {
        const p = new URLSearchParams(params);
        if (active) p.delete("inbox");
        else p.set("inbox", "1");
        setParams(p);
      }}
      className={cn(
        "relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent",
        active && "bg-sidebar-accent"
      )}
      title={`${state.unread} unread`}
    >
      <Bell className="size-5" />
      {state.unread > 0 && (
        <span className="absolute right-1 top-1 size-2.5 rounded-full bg-red-600 ring-2 ring-sidebar" />
      )}
    </button>
  );
}

export function VariantCInbox({ state }: { state: ProtoState }) {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const close = () => {
    const p = new URLSearchParams(params);
    p.delete("inbox");
    setParams(p);
  };
  const byLesson = useMemo(() => {
    const m = new Map<string, ProtoNotification[]>();
    for (const n of state.items) {
      const k = `${n.courseTitle} › ${n.lessonTitle}`;
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    return [...m.entries()];
  }, [state.items]);
  const sel = state.items.find((n) => n.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <h1 className="text-xl font-bold">Notifications</h1>
        <span className="text-sm text-muted-foreground">{state.unread} unread</span>
        <button
          onClick={state.markAllRead}
          disabled={state.unread === 0}
          className="ml-auto rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
        >
          Mark all read
        </button>
        <button onClick={close} className="rounded-md p-1.5 hover:bg-muted" title="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[26rem] shrink-0 overflow-y-auto border-r">
          {byLesson.map(([lesson, items]) => (
            <section key={lesson}>
              <h3 className="sticky top-0 bg-muted/80 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                {lesson}
              </h3>
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSelected(n.id);
                    state.markRead([n.id]); // read on view, not on navigate
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 border-b px-4 py-3 text-left text-sm",
                    selected === n.id ? "bg-primary/10" : "hover:bg-muted",
                    n.read && "text-muted-foreground"
                  )}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", !n.read && "bg-primary")} />
                  <span className="flex-1">
                    <span className={cn(!n.read && "font-semibold")}>{n.actorName}</span>{" "}
                    {sentence(n).what.replace(/ on$/, "")}
                  </span>
                  <span className="text-xs">{ago(n.minutesAgo)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-8">
          {sel ? (
            <div className="max-w-xl space-y-4">
              <div className="text-sm text-muted-foreground">
                {sel.courseTitle} › {sel.lessonTitle} · {ago(sel.minutesAgo)} ago
              </div>
              <div className="text-lg">
                <Line n={sel} />
              </div>
              <blockquote className="rounded-lg border bg-muted/40 p-4">{sel.snippet}</blockquote>
              <button
                onClick={() => state.open([sel.id], sel.href)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Open in lesson <ExternalLink className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Select a Notification to preview it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
