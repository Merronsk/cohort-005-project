// PROTOTYPE — throwaway.
export type ProtoNotificationKind =
  | "comment-on-your-lesson" // Instructor: a Student posted a Comment on their lesson
  | "reply-to-your-comment" // Comment author: someone Replied to it
  | "reply-in-thread"; // Participant: someone Replied in a thread they Replied in

export interface ProtoNotification {
  id: number;
  kind: ProtoNotificationKind;
  actorName: string;
  lessonTitle: string;
  courseTitle: string;
  threadId: number;
  snippet: string;
  minutesAgo: number;
  read: boolean;
  href: string;
}

export function sentence(n: Pick<ProtoNotification, "kind" | "actorName">) {
  switch (n.kind) {
    case "comment-on-your-lesson":
      return { who: n.actorName, what: "commented on" };
    case "reply-to-your-comment":
      return { who: n.actorName, what: "replied to your Comment on" };
    case "reply-in-thread":
      return { who: n.actorName, what: "replied in a thread you're in on" };
  }
}

export function ago(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 60 / 24)}d`;
}

export function badge(count: number) {
  return count > 9 ? "9+" : String(count);
}
