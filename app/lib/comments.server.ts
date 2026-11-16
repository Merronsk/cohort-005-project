import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import {
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  notifications,
  NotificationReason,
  UserRole,
  users,
} from "~/db/schema";
import {
  commentAnchorId,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from "~/lib/comments";

// ─── Comments and Notifications ───
// Posting Comments and Replies, and the Notifications they create.
// See GLOSSARY.md for the language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type Comment = typeof comments.$inferSelect;

export function postComment(
  db: Db,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Comment {
  const trimmed = assertValidBody(body);

  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = db
      .select()
      .from(comments)
      .where(eq(comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
    // The UI hides the Reply button on a deleted Comment; this stops a
    // crafted request too.
    if (parent.deletedAt !== null) {
      throw new Error("This Comment has been deleted");
    }
  }

  return db.transaction((tx) => {
    const comment = tx
      .insert(comments)
      .values({ userId: authorId, lessonId, parentId, body: trimmed })
      .returning()
      .get();

    for (const { recipientId, reason } of recipientsFor(tx, comment)) {
      tx.insert(notifications)
        .values({ recipientId, commentId: comment.id, reason })
        // One Notification per recipient per target (unique key).
        .onConflictDoNothing()
        .run();
    }

    return comment;
  });
}

// Throws a user-correctable Error; returns the trimmed body otherwise.
function assertValidBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

// ─── Who is notified ───

type Recipient = { recipientId: number; reason: NotificationReason };

// The Notifications a newly posted Comment or Reply creates.
function recipientsFor(tx: Tx, comment: Comment): Recipient[] {
  if (comment.parentId !== null) {
    return replyRecipients(tx, comment, comment.parentId);
  }
  return commentRecipients(tx, comment);
}

// A new top-level Comment by a Student who isn't the course's Instructor
// notifies the course's Instructor.
function commentRecipients(tx: Tx, comment: Comment): Recipient[] {
  const row = tx
    .select({ instructorId: courses.instructorId, authorRole: users.role })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .innerJoin(users, eq(users.id, comment.userId))
    .where(eq(lessons.id, comment.lessonId))
    .get();
  if (
    !row ||
    row.authorRole !== UserRole.Student ||
    row.instructorId === comment.userId
  ) {
    return [];
  }
  return [
    {
      recipientId: row.instructorId,
      reason: NotificationReason.CommentOnYourLesson,
    },
  ];
}

// A new Reply notifies the thread's other Participants: the Comment's author
// (reply_to_your_comment, which wins if they also replied) and the authors of
// its Replies that aren't deleted (reply_in_your_thread). Platform Admins are
// never notified.
function replyRecipients(
  tx: Tx,
  reply: Comment,
  parentId: number
): Recipient[] {
  const parent = tx
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, parentId))
    .get();
  if (!parent) {
    return [];
  }

  const replyAuthors = tx
    .selectDistinct({ userId: comments.userId })
    .from(comments)
    .where(and(eq(comments.parentId, parentId), isNull(comments.deletedAt)))
    .all()
    .map((r) => r.userId);

  const reasons = new Map<number, NotificationReason>();
  for (const userId of replyAuthors) {
    reasons.set(userId, NotificationReason.ReplyInYourThread);
  }
  reasons.set(parent.userId, NotificationReason.ReplyToYourComment);
  reasons.delete(reply.userId);
  if (reasons.size === 0) {
    return [];
  }

  // Only people who can view the course's content right now: the owning
  // Instructor or anyone with an Enrollment. PPP is deliberately not checked.
  // Lapsed and refunded Students have no Enrollment, so they're skipped here
  // but stay Participants.
  const course = tx
    .select({ id: courses.id, instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(lessons.id, reply.lessonId))
    .get();
  if (!course) {
    return [];
  }
  const enrolled = tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, users.id),
        eq(enrollments.courseId, course.id)
      )
    );
  const eligible = new Set(
    tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [...reasons.keys()]),
          inArray(users.role, [UserRole.Student, UserRole.Instructor]),
          or(eq(users.id, course.instructorId), exists(enrolled))
        )
      )
      .all()
      .map((u) => u.id)
  );

  return [...reasons]
    .filter(([userId]) => eligible.has(userId))
    .map(([recipientId, reason]) => ({ recipientId, reason }));
}

// ─── Reading Notifications ───

export const NOTIFICATION_LIST_LIMIT = 50;

export type NotificationItem = {
  id: number;
  reason: NotificationReason;
  read: boolean;
  createdAt: string;
  actorName: string;
  // The target's current body. Untrusted Markdown: show as plain text only.
  preview: string;
  lessonId: number;
  lessonTitle: string;
  courseSlug: string;
  courseTitle: string;
  // The target Comment or Reply, for the #comment-<id> anchor.
  targetId: number;
};

// The recipient's newest Notifications whose target isn't deleted, newest
// first. The actor, preview, lesson and course are joined live.
export function listNotifications(
  db: Db,
  recipientId: number
): NotificationItem[] {
  return db
    .select({
      id: notifications.id,
      reason: notifications.reason,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      preview: comments.body,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      targetId: comments.id,
    })
    .from(notifications)
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(visibleTo(recipientId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_LIST_LIMIT)
    .all()
    .map(({ readAt, ...row }) => ({ ...row, read: readAt !== null }));
}

// Every unread Notification whose target isn't deleted, beyond the list's 50.
export function countUnread(db: Db, recipientId: number): number {
  const row = db
    .select({ n: count() })
    .from(notifications)
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .where(and(visibleTo(recipientId), isNull(notifications.readAt)))
    .get();
  return row?.n ?? 0;
}

// ─── Marking read ───

// Marks the recipient's own Notification read and returns the lesson link
// with the target's anchor. Null when it isn't theirs or doesn't exist.
export function markRead(
  db: Db,
  recipientId: number,
  notificationId: number
): string | null {
  const row = db
    .select({
      readAt: notifications.readAt,
      targetId: comments.id,
      lessonId: lessons.id,
      courseSlug: courses.slug,
    })
    .from(notifications)
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId)
      )
    )
    .get();
  if (!row) {
    return null;
  }

  if (row.readAt === null) {
    db.update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(eq(notifications.id, notificationId))
      .run();
  }

  return `/courses/${row.courseSlug}/lessons/${row.lessonId}#${commentAnchorId(row.targetId)}`;
}

// Marks every unread Notification of the recipient read, including those
// beyond the list's 50 and those whose target is deleted, so the badge drops
// to zero.
export function markAllRead(db: Db, recipientId: number): void {
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .run();
}

// The recipient's Notifications whose target isn't deleted. The query must
// join `comments` on the target.
function visibleTo(recipientId: number) {
  return and(
    eq(notifications.recipientId, recipientId),
    isNull(comments.deletedAt)
  );
}
