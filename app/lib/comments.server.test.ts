import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  countUnread,
  listNotifications,
  markRead,
  postComment,
} from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

describe("postComment", () => {
  it("posts a top-level Comment with its body trimmed", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "  Hello?  ");

    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "Hello?",
    });
  });

  it("rejects an empty body and inserts nothing", () => {
    expect(() => postComment(db, base.user.id, lessonId, null, "   ")).toThrow(
      "Comment cannot be empty"
    );
    expect(db.select().from(schema.comments).all()).toHaveLength(0);
  });

  it("accepts 5000 characters but rejects 5001", () => {
    expect(() =>
      postComment(db, base.user.id, lessonId, null, "a".repeat(5000))
    ).not.toThrow();
    expect(() =>
      postComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow("Comment must be 5000 characters or fewer");
  });

  it("rejects a Comment on a lesson that doesn't exist", () => {
    expect(() => postComment(db, base.user.id, 9999, null, "Hello?")).toThrow(
      "Lesson not found"
    );
  });

  it("posts a Reply to a top-level Comment on the same lesson", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question");
    const reply = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Answer"
    );

    expect(reply).toMatchObject({
      userId: base.instructor.id,
      lessonId,
      parentId: comment.id,
      body: "Answer",
    });
  });

  it("rejects a Reply to a Reply", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question");
    const reply = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "A"
    );

    expect(() =>
      postComment(db, base.user.id, lessonId, reply.id, "Nested")
    ).toThrow("Replies can only be one level deep");
  });

  it("rejects a Reply to a Comment that doesn't exist", () => {
    expect(() => postComment(db, base.user.id, lessonId, 9999, "Hi")).toThrow(
      "Parent comment not found"
    );
  });

  it("rejects a Reply to a Comment on another lesson", () => {
    const otherLessonId = db
      .insert(schema.lessons)
      .values({
        moduleId: db.select().from(schema.modules).get()!.id,
        title: "Lesson 2",
        position: 2,
      })
      .returning()
      .get().id;
    const comment = postComment(db, base.user.id, otherLessonId, null, "Q");

    expect(() =>
      postComment(db, base.instructor.id, lessonId, comment.id, "A")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("rejects a Reply to a deleted Comment and inserts nothing", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question");
    // Soft delete, the same way the lesson route's delete does.
    db.update(schema.comments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.comments.id, comment.id))
      .run();

    expect(() =>
      postComment(db, base.instructor.id, lessonId, comment.id, "Answer")
    ).toThrow("This Comment has been deleted");
    expect(db.select().from(schema.comments).all()).toHaveLength(1);
  });
});

describe("comment_on_your_lesson Notifications", () => {
  it("notifies the course's Instructor when a Student posts a Comment", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question?");

    expect(listNotifications(db, base.instructor.id)).toEqual([
      {
        id: expect.any(Number),
        reason: "comment_on_your_lesson",
        read: false,
        createdAt: expect.any(String),
        actorName: "Test User",
        preview: "Question?",
        lessonId,
        lessonTitle: "Lesson 1",
        courseSlug: "test-course",
        courseTitle: "Test Course",
        targetId: comment.id,
      },
    ]);
  });

  it("doesn't notify the Instructor about their own Comment", () => {
    postComment(db, base.instructor.id, lessonId, null, "Note from me");

    expect(listNotifications(db, base.instructor.id)).toEqual([]);
  });

  it("doesn't notify anyone about a Platform Admin's Comment", () => {
    const admin = addUser("Admin", schema.UserRole.Admin);
    postComment(db, admin.id, lessonId, null, "Moderator note");

    expect(listNotifications(db, base.instructor.id)).toEqual([]);
    expect(countUnread(db, base.instructor.id)).toBe(0);
  });

  it("doesn't notify a Student about anything in this ticket's scope", () => {
    postComment(db, base.user.id, lessonId, null, "Question?");

    expect(listNotifications(db, base.user.id)).toEqual([]);
  });

  it("hides the Notification once its target is deleted, read or unread", () => {
    const unread = postComment(db, base.user.id, lessonId, null, "One");
    const read = postComment(db, base.user.id, lessonId, null, "Two");
    const kept = postComment(db, base.user.id, lessonId, null, "Three");
    const readNotification = listNotifications(db, base.instructor.id).find(
      (n) => n.targetId === read.id
    )!;
    markRead(db, base.instructor.id, readNotification.id);

    softDelete(unread.id);
    softDelete(read.id);

    expect(
      listNotifications(db, base.instructor.id).map((n) => n.targetId)
    ).toEqual([kept.id]);
    expect(countUnread(db, base.instructor.id)).toBe(1);
  });

  it("shows the edited body as the preview and creates nothing on edit", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Typo");
    // Edit, the same way the lesson route's edit does.
    db.update(schema.comments)
      .set({ body: "Fixed", editedAt: new Date().toISOString() })
      .where(eq(schema.comments.id, comment.id))
      .run();

    const list = listNotifications(db, base.instructor.id);
    expect(list).toHaveLength(1);
    expect(list[0].preview).toBe("Fixed");
  });

  it("lists newest first, capped at 50, while countUnread counts them all", () => {
    const posted = Array.from({ length: 55 }, (_, i) =>
      postComment(db, base.user.id, lessonId, null, `Comment ${i}`)
    );

    const list = listNotifications(db, base.instructor.id);
    expect(list).toHaveLength(50);
    expect(list[0].targetId).toBe(posted[54].id);
    expect(list[49].targetId).toBe(posted[5].id);
    expect(countUnread(db, base.instructor.id)).toBe(55);
  });

  it("orders by creation time, not by insertion order", () => {
    const older = postComment(db, base.user.id, lessonId, null, "Older");
    const newer = postComment(db, base.user.id, lessonId, null, "Newer");
    db.update(schema.notifications)
      .set({ createdAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.notifications.commentId, newer.id))
      .run();

    expect(
      listNotifications(db, base.instructor.id).map((n) => n.targetId)
    ).toEqual([older.id, newer.id]);
  });

  it("can't hold a second Notification for the same recipient and target", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question?");

    expect(() =>
      db
        .insert(schema.notifications)
        .values({
          recipientId: base.instructor.id,
          commentId: comment.id,
          reason: schema.NotificationReason.CommentOnYourLesson,
        })
        .run()
    ).toThrow(/UNIQUE/);
    expect(listNotifications(db, base.instructor.id)).toHaveLength(1);
  });
});

describe("Reply Notifications", () => {
  it("notifies the enrolled Comment author with reply_to_your_comment", () => {
    enroll(base.user.id);
    const comment = postComment(db, base.user.id, lessonId, null, "Question?");
    const reply = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Answer"
    );

    expect(listNotifications(db, base.user.id)).toEqual([
      {
        id: expect.any(Number),
        reason: "reply_to_your_comment",
        read: false,
        createdAt: expect.any(String),
        actorName: "Test Instructor",
        preview: "Answer",
        lessonId,
        lessonTitle: "Lesson 1",
        courseSlug: "test-course",
        courseTitle: "Test Course",
        targetId: reply.id,
      },
    ]);
  });

  it("notifies the other Participants with reply_in_your_thread", () => {
    const ben = addUser("Ben", schema.UserRole.Student);
    const cara = addUser("Cara", schema.UserRole.Student);
    [base.user.id, ben.id, cara.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    postComment(db, ben.id, lessonId, comment.id, "Me too");

    const reply = postComment(db, cara.id, lessonId, comment.id, "Same");

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
      [ben.id]: "reply_in_your_thread",
    });
  });

  it("never notifies the Reply's author, a Platform Admin, or a non-Participant Instructor", () => {
    const admin = addUser("Admin", schema.UserRole.Admin);
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    postComment(db, admin.id, lessonId, comment.id, "Moderator note");

    const reply = postComment(db, ben.id, lessonId, comment.id, "Me too");

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
    });
  });

  it("still notifies others about a Platform Admin's Reply", () => {
    const admin = addUser("Admin", schema.UserRole.Admin);
    enroll(base.user.id);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");

    const reply = postComment(db, admin.id, lessonId, comment.id, "Note");

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
    });
  });

  it("skips a Participant without an Enrollment but notifies them again once re-enrolled", () => {
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    postComment(db, ben.id, lessonId, comment.id, "Me too");
    // Lapsed, or refunded: an approved Refund Request deletes the Enrollment.
    unenroll(base.user.id);

    const whileLapsed = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Answer"
    );
    enroll(base.user.id);
    const afterReturn = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Follow-up"
    );

    expect(reasonsFor(whileLapsed.id)).toEqual({
      [ben.id]: "reply_in_your_thread",
    });
    expect(reasonsFor(afterReturn.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
      [ben.id]: "reply_in_your_thread",
    });
  });

  it("always treats the owning Instructor as eligible, but not another Instructor without an Enrollment", () => {
    const guest = addUser("Guest", schema.UserRole.Instructor);
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    postComment(db, base.instructor.id, lessonId, comment.id, "Answer");
    postComment(db, guest.id, lessonId, comment.id, "Drive-by");

    const reply = postComment(db, ben.id, lessonId, comment.id, "Thanks");

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
      [base.instructor.id]: "reply_in_your_thread",
    });
  });

  it("gives a Participant with several Replies one Notification, and the Comment author who replied reply_to_your_comment", () => {
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    postComment(db, ben.id, lessonId, comment.id, "One");
    postComment(db, ben.id, lessonId, comment.id, "Two");
    postComment(db, base.user.id, lessonId, comment.id, "Still stuck");

    const reply = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Answer"
    );

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
      [ben.id]: "reply_in_your_thread",
    });
    expect(
      listNotifications(db, ben.id).filter((n) => n.targetId === reply.id)
    ).toHaveLength(1);
  });

  it("stops notifying a Participant whose only Reply was deleted", () => {
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    const bens = postComment(db, ben.id, lessonId, comment.id, "Me too");
    softDelete(bens.id);

    const reply = postComment(
      db,
      base.instructor.id,
      lessonId,
      comment.id,
      "Answer"
    );

    expect(reasonsFor(reply.id)).toEqual({
      [base.user.id]: "reply_to_your_comment",
    });
  });

  it("keeps Reply Notifications when the parent Comment is deleted, and hides a deleted Reply's own", () => {
    const ben = addUser("Ben", schema.UserRole.Student);
    [base.user.id, ben.id].forEach(enroll);
    const comment = postComment(db, base.user.id, lessonId, null, "Q");
    const kept = postComment(db, ben.id, lessonId, comment.id, "Kept");
    const removed = postComment(db, ben.id, lessonId, comment.id, "Removed");

    softDelete(comment.id);
    softDelete(removed.id);

    expect(listNotifications(db, base.user.id).map((n) => n.targetId)).toEqual(
      [kept.id]
    );
    expect(countUnread(db, base.user.id)).toBe(1);
  });
});

describe("markRead", () => {
  it("marks the recipient's Notification read and returns the lesson link", () => {
    const comment = postComment(db, base.user.id, lessonId, null, "Question?");
    const [notification] = listNotifications(db, base.instructor.id);

    const href = markRead(db, base.instructor.id, notification.id);

    expect(href).toBe(
      `/courses/test-course/lessons/${lessonId}#comment-${comment.id}`
    );
    expect(listNotifications(db, base.instructor.id)[0].read).toBe(true);
    expect(countUnread(db, base.instructor.id)).toBe(0);
  });

  it("returns null and changes nothing for someone else's Notification", () => {
    postComment(db, base.user.id, lessonId, null, "Question?");
    const [notification] = listNotifications(db, base.instructor.id);

    expect(markRead(db, base.user.id, notification.id)).toBeNull();
    expect(countUnread(db, base.instructor.id)).toBe(1);
  });

  it("returns null for a Notification that doesn't exist", () => {
    expect(markRead(db, base.instructor.id, 9999)).toBeNull();
  });
});

function addUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

// Soft delete, the same way the lesson route's delete does.
function softDelete(commentId: number) {
  db.update(schema.comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.comments.id, commentId))
    .run();
}

function enroll(userId: number) {
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

// For everyone in the test, the reason they were notified about this target,
// as listNotifications shows it. People without one are left out.
function reasonsFor(targetId: number) {
  const everyone = db.select({ id: schema.users.id }).from(schema.users).all();
  return Object.fromEntries(
    everyone.flatMap(({ id }) => {
      const n = listNotifications(db, id).find((n) => n.targetId === targetId);
      return n ? [[id, n.reason]] : [];
    })
  );
}

function unenroll(userId: number) {
  db.delete(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .run();
}
