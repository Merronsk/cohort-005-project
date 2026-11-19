import { describe, expect, it } from "vitest";
import { flattenCourseLessons } from "../course.server";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import {
  calculateGrade,
  getQuizWithQuestions,
  submitQuizAttempt,
} from "../quiz.server";

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

// No quiz-authoring function lives in this module, so the quiz goes in
// directly. Kept in one fixture so a schema change touches only this block.
function setUpQuiz() {
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
  let position = 0;

  // A question with one right and one wrong option, or two wrong ones.
  function addQuestion(
    type = QuestionType.MultipleChoice,
    hasCorrectOption = true
  ) {
    position += 1;
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
    const [right, wrong] = [hasCorrectOption, false].map((isCorrect) =>
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

  function answersFor(db: TestDb, attemptId: number) {
    return db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, attemptId))
      .all();
  }

  return { db, userId: user.id, quizId: quiz.id, addQuestion, answersFor };
}

describe("submitQuizAttempt", () => {
  it("grades each answer against the correct option and records it", () => {
    const { db, userId, quizId, addQuestion, answersFor } = setUpQuiz();
    const first = addQuestion(QuestionType.MultipleChoice);
    const second = addQuestion(QuestionType.TrueFalse);

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: { [first.id]: first.right, [second.id]: second.wrong },
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
    expect(
      answersFor(db, result.attemptId).map((a) => a.selectedOptionId)
    ).toEqual(expect.arrayContaining([first.right, second.wrong]));
  });

  it("counts an unanswered question as wrong and records no answer for it", () => {
    const { db, userId, quizId, addQuestion, answersFor } = setUpQuiz();
    const first = addQuestion();
    const second = addQuestion();

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: { [first.id]: first.right },
    });

    expect(result.questionResults[1]).toEqual({
      questionId: second.id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    });
    expect(answersFor(db, result.attemptId)).toHaveLength(1);
  });

  it("records an attempt with no answers at all", () => {
    const { db, userId, quizId, addQuestion, answersFor } = setUpQuiz();
    addQuestion();

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: {},
    });

    expect(result).toMatchObject({ score: 0, passed: false, totalCorrect: 0 });
    expect(answersFor(db, result.attemptId)).toEqual([]);
  });

  it("scores a quiz with no questions as 0, not NaN", () => {
    const { db, userId, quizId } = setUpQuiz();

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: {},
    });

    expect(result).toMatchObject({
      score: 0,
      passed: false,
      totalQuestions: 0,
    });
  });

  it("marks an answer wrong when its question has no correct option", () => {
    const { db, userId, quizId, addQuestion } = setUpQuiz();
    const question = addQuestion(QuestionType.MultipleChoice, false);

    const result = submitQuizAttempt(db, {
      userId,
      quizId,
      selectedAnswers: { [question.id]: question.right },
    });

    expect(result.questionResults[0]).toMatchObject({
      correct: false,
      correctOptionId: null,
    });
  });

  it("passes only above 70%", () => {
    const { db, userId, quizId, addQuestion } = setUpQuiz();
    const questions = Array.from({ length: 10 }, () => addQuestion());
    const submit = (rightCount: number) =>
      submitQuizAttempt(db, {
        userId,
        quizId,
        selectedAnswers: Object.fromEntries(
          questions.map((q, i) => [q.id, i < rightCount ? q.right : q.wrong])
        ),
      });

    expect(submit(7)).toMatchObject({ score: 0.7, passed: false });
    expect(submit(8)).toMatchObject({ score: 0.8, passed: true });
  });
});

describe("getQuizWithQuestions", () => {
  it("returns null for a quiz that does not exist", () => {
    const { db } = setUpQuiz();

    expect(getQuizWithQuestions(db, 9999)).toBeNull();
  });

  it("lists questions in order, each with only its own options", () => {
    const { db, quizId, addQuestion } = setUpQuiz();
    const first = addQuestion();
    const second = addQuestion(QuestionType.TrueFalse);

    const quiz = getQuizWithQuestions(db, quizId);

    expect(
      quiz?.questions.map((q) => ({
        id: q.id,
        options: q.options.map((o) => o.id),
      }))
    ).toEqual([
      { id: first.id, options: [first.right, first.wrong] },
      { id: second.id, options: [second.right, second.wrong] },
    ]);
  });

  it("returns a quiz with no questions", () => {
    const { db, quizId } = setUpQuiz();

    expect(getQuizWithQuestions(db, quizId)?.questions).toEqual([]);
  });
});
