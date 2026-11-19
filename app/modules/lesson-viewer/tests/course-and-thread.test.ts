import { describe, expect, it } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import { getCourseForLesson, getCourseWithDetails } from "../course.server";
import { getLessonThread } from "../thread.server";

// This module only reads courses and comments, so the rows go in directly.
// Kept in one place so a schema change touches only this block.
function setUp() {
  const db = createTestDb();
  const base = seedBaseData(db);
  const course = base.course;

  function addModule(position: number) {
    return db
      .insert(schema.modules)
      .values({ courseId: course.id, title: `M${position}`, position })
      .returning()
      .get();
  }

  function addLesson(moduleId: number, position: number) {
    return db
      .insert(schema.lessons)
      .values({ moduleId, title: `L${position}`, position })
      .returning()
      .get();
  }

  return { db, base, course, addModule, addLesson };
}

function addComment(
  db: TestDb,
  values: {
    lessonId: number;
    userId: number;
    parentId?: number;
    deletedAt?: string;
    body?: string;
  }
) {
  return db
    .insert(schema.comments)
    .values({ ...values, body: markdown(values.body ?? "hi") })
    .returning()
    .get();
}

describe("getCourseWithDetails", () => {
  it("returns null for a course that does not exist", () => {
    const { db } = setUp();

    expect(getCourseWithDetails(db, 9999)).toBeNull();
  });

  it("nests each module's lessons, both in position order", () => {
    const { db, base, course, addModule, addLesson } = setUp();
    const second = addModule(2);
    const first = addModule(1);
    const empty = addModule(3);
    const b = addLesson(first.id, 2);
    const a = addLesson(first.id, 1);
    const c = addLesson(second.id, 1);

    const details = getCourseWithDetails(db, course.id);

    expect(details).toMatchObject({
      id: course.id,
      instructorName: base.instructor.name,
      categoryName: base.category.name,
    });
    expect(
      details?.modules.map((m) => ({
        id: m.id,
        lessons: m.lessons.map((l) => l.id),
      }))
    ).toEqual([
      { id: first.id, lessons: [a.id, b.id] },
      { id: second.id, lessons: [c.id] },
      { id: empty.id, lessons: [] },
    ]);
  });
});

describe("getCourseForLesson", () => {
  it("finds the course a lesson belongs to", () => {
    const { db, course, addModule, addLesson } = setUp();
    const lesson = addLesson(addModule(1).id, 1);

    expect(getCourseForLesson(db, lesson.id)).toEqual({
      courseId: course.id,
      courseTitle: course.title,
      courseSlug: course.slug,
      instructorId: course.instructorId,
    });
  });
});

describe("getLessonThread", () => {
  function setUpThread() {
    const fixture = setUp();
    const lesson = fixture.addLesson(fixture.addModule(1).id, 1);
    const admin = fixture.db
      .insert(schema.users)
      .values({ name: "Ada", email: "ada@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const comment = (values: {
      userId: number;
      parentId?: number;
      deletedAt?: string;
      body?: string;
    }) => addComment(fixture.db, { lessonId: lesson.id, ...values });
    return { ...fixture, lesson, admin, comment };
  }

  it("is empty for a lesson that does not exist", () => {
    const { db } = setUp();

    expect(getLessonThread(db, 9999)).toEqual([]);
  });

  it("nests replies under their question and marks who is staff", () => {
    const { db, base, lesson, admin, comment } = setUpThread();
    const question = comment({ userId: base.user.id, body: "why?" });
    const answer = comment({
      userId: base.instructor.id,
      parentId: question.id,
    });
    const aside = comment({ userId: admin.id, parentId: question.id });

    const thread = getLessonThread(db, lesson.id);

    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      id: question.id,
      body: "why?",
      deleted: false,
      editedAt: null,
      author: {
        id: base.user.id,
        name: base.user.name,
        isInstructor: false,
        isPlatformAdmin: false,
      },
    });
    expect(thread[0].replies.map((r) => [r.id, r.author])).toEqual([
      [
        answer.id,
        expect.objectContaining({ isInstructor: true, isPlatformAdmin: false }),
      ],
      [
        aside.id,
        expect.objectContaining({ isInstructor: false, isPlatformAdmin: true }),
      ],
    ]);
  });

  it("hides deleted replies and blanks a deleted question that has replies", () => {
    const { db, base, lesson, comment } = setUpThread();
    const deletedAt = "2026-11-01T00:00:00.000Z";
    const kept = comment({ userId: base.user.id, deletedAt, body: "secret" });
    const reply = comment({ userId: base.instructor.id, parentId: kept.id });
    comment({ userId: base.user.id, parentId: kept.id, deletedAt });
    comment({ userId: base.user.id, deletedAt });

    const thread = getLessonThread(db, lesson.id);

    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      id: kept.id,
      body: "",
      deleted: true,
      editedAt: null,
    });
    expect(thread[0].replies.map((r) => r.id)).toEqual([reply.id]);
  });

  it("drops a reply to a reply, since replies are one level deep", () => {
    const { db, base, lesson, comment } = setUpThread();
    const question = comment({ userId: base.user.id });
    const reply = comment({ userId: base.user.id, parentId: question.id });
    comment({ userId: base.user.id, parentId: reply.id });

    const thread = getLessonThread(db, lesson.id);

    expect(thread.map((c) => c.replies.map((r) => r.id))).toEqual([[reply.id]]);
  });
});
