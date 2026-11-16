import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { postComment } from "./comments.server";

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
