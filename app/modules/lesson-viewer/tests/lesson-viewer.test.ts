import { describe, expect, it } from "vitest";
import { flattenCourseLessons } from "../course.server";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { calculateGrade, submitQuizAttempt } from "../quiz.server";

describe("calculateGrade", () => {
  it.each([
    [1, "A"],
    [0.9, "A"],
    [0.89, "B"],
    [0.8, "B"],
    [0.7, "C"],
    [0.6, "D"],
    [0.59, "F"],
    [0, "F"],
  ])("grades a score of %s as %s", (score, grade) => {
    expect(calculateGrade(score)).toBe(grade);
  });
});

describe("flattenCourseLessons", () => {
  it("lists every lesson in module order, tagged with its module", () => {
    const flat = flattenCourseLessons({
      modules: [
        {
          id: 1,
          title: "Basics",
          lessons: [
            { id: 10, title: "Hello", moduleId: 1 },
            { id: 11, title: "Types", moduleId: 1 },
          ],
        },
        { id: 2, title: "Empty", lessons: [] },
        {
          id: 3,
          title: "Generics",
          lessons: [{ id: 30, title: "T", moduleId: 3 }],
        },
      ],
    });

    expect(flat).toEqual([
      { id: 10, title: "Hello", moduleId: 1, moduleTitle: "Basics" },
      { id: 11, title: "Types", moduleId: 1, moduleTitle: "Basics" },
      { id: 30, title: "T", moduleId: 3, moduleTitle: "Generics" },
    ]);
  });
});

describe("submitQuizAttempt", () => {
  // No quiz-authoring function lives in this module, so the quiz goes in
  // directly. Kept in one fixture so a schema change touches only this block.
  function setUp() {
    const db = createTestDb();
    const { user, course } = seedBaseData(db);
    const mod = db
      .insert(schema.modules)
      .values({ courseId: course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    const lesson = db
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: "Hello", position: 1 })
      .returning()
      .get();
    const quiz = db
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Check", passingScore: 0.7 })
      .returning()
      .get();

    function addQuestion(position: number, type: QuestionType) {
      const question = db
        .insert(schema.quizQuestions)
        .values({
          quizId: quiz.id,
          questionText: `Q${position}`,
          questionType: type,
          position,
        })
        .returning()
        .get();
      const [right, wrong] = [true, false].map((isCorrect) =>
        db
          .insert(schema.quizOptions)
          .values({
            questionId: question.id,
            optionText: String(isCorrect),
            isCorrect,
          })
          .returning()
          .get()
      );
      return { id: question.id, right: right.id, wrong: wrong.id };
    }

    const first = addQuestion(1, QuestionType.MultipleChoice);
    const second = addQuestion(2, QuestionType.TrueFalse);
    return { db, userId: user.id, quizId: quiz.id, first, second };
  }

  it("grades each answer against the correct option and records it", () => {
    const { db, userId, quizId, first, second } = setUp();

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: {
        [first.id]: first.right,
        [second.id]: second.wrong,
      },
    });

    expect(result).toMatchObject({
      score: 0.5,
      passed: false,
      grade: "F",
      totalCorrect: 1,
      totalQuestions: 2,
      questionResults: [
        {
          questionId: first.id,
          correct: true,
          selectedOptionId: first.right,
          correctOptionId: first.right,
        },
        {
          questionId: second.id,
          correct: false,
          selectedOptionId: second.wrong,
          correctOptionId: second.right,
        },
      ],
    });
    const answers = db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result.attemptId))
      .all();
    expect(answers.map((a) => a.selectedOptionId).sort()).toEqual(
      [first.right, second.wrong].sort()
    );
  });

  it("passes only above 70% and counts an unanswered question as wrong", () => {
    const { db, userId, quizId, first, second } = setUp();

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: {
        [first.id]: first.right,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.questionResults[1]).toEqual({
      questionId: second.id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    });

    const allRight = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: {
        [first.id]: first.right,
        [second.id]: second.right,
      },
    });
    expect(allRight).toMatchObject({ score: 1, passed: true, grade: "A" });
  });
});
