// PROTOTYPE — throwaway. Lives on branch prototype/notification-bell only.
// Builds fake in-memory Notifications from real lessons and users so clicking
// one lands on a real lesson page. Nothing is written to the database.
import { db } from "~/db";
import { courses, lessons, modules, users, UserRole } from "~/db/schema";
import { eq, ne } from "drizzle-orm";
import type { ProtoNotification } from "./types";

export function buildPrototypeNotifications(
  currentUser: { id: number; role: UserRole } | null
): ProtoNotification[] {
  if (!currentUser) return [];
  // Platform Admins get no Notifications (out of scope on the map).
  if (currentUser.role === UserRole.Admin) return [];

  const lessonRows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .limit(4)
    .all();
  const others = db
    .select({ name: users.name })
    .from(users)
    .where(ne(users.id, currentUser.id))
    .limit(6)
    .all()
    .map((u) => u.name);

  if (lessonRows.length === 0) return [];
  const L = (i: number) => lessonRows[i % lessonRows.length];
  const P = (i: number) => others[i % Math.max(others.length, 1)] ?? "Someone";

  const isInstructor = currentUser.role === UserRole.Instructor;
  let id = 0;
  let commentId = 900;
  const make = (
    kind: ProtoNotification["kind"],
    lessonIdx: number,
    actorIdx: number,
    threadId: number,
    minutesAgo: number,
    snippet: string,
    read = false
  ): ProtoNotification => {
    const l = L(lessonIdx);
    const target = commentId++;
    return {
      id: ++id,
      kind,
      actorName: P(actorIdx),
      lessonTitle: l.lessonTitle,
      courseTitle: l.courseTitle,
      threadId,
      snippet,
      minutesAgo,
      read,
      href: `/courses/${l.courseSlug}/lessons/${l.lessonId}#comment-${target}`,
    };
  };

  const list: ProtoNotification[] = [
    // A busy thread: four Replies to the viewer's own Comment.
    make("reply-to-your-comment", 0, 0, 1, 3, "Same here — the second example fails for me too on Node 22."),
    make("reply-to-your-comment", 0, 1, 1, 9, "Did you try clearing the cache first?"),
    make("reply-to-your-comment", 0, 2, 1, 26, "This worked for me: rename the file to .mjs."),
    make("reply-to-your-comment", 0, 3, 1, 70, "+1, I'm stuck on exactly this step."),
    // A thread the viewer Replied in but did not start.
    make("reply-in-thread", 1, 4, 2, 45, "I think the answer is in the next module, actually."),
    make("reply-in-thread", 1, 0, 2, 60 * 5, "Thanks, that cleared it up!", true),
    make("reply-to-your-comment", 2, 1, 3, 60 * 26, "Great question. Short answer: no.", true),
    make("reply-to-your-comment", 3, 2, 4, 60 * 24 * 4, "Fixed in the updated video.", true),
  ];

  if (isInstructor) {
    list.push(
      make("comment-on-your-lesson", 1, 3, 5, 12, "Could you explain why we need useEffect here instead of a loader?"),
      make("comment-on-your-lesson", 1, 5, 6, 38, "The repo link at the bottom is 404ing."),
      make("comment-on-your-lesson", 2, 4, 7, 60 * 3, "Loved this lesson. Any reading recommendations?"),
      make("comment-on-your-lesson", 3, 0, 8, 60 * 30, "Audio cuts out around 4:10.", true)
    );
  }

  return list.sort((a, b) => a.minutesAgo - b.minutesAgo);
}
