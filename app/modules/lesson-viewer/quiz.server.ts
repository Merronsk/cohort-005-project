import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function getQuizById(quizId: number) {
  return db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
}

export function getQuizByLessonId(lessonId: number) {
  return db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId)).get();
}

export function getQuizWithQuestions(database: Db, quizId: number) {
  const quiz = database
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .get();
  if (!quiz) return null;

  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  const options = database
    .select()
    .from(quizOptions)
    .where(
      inArray(
        quizOptions.questionId,
        questions.map((q) => q.id)
      )
    )
    .orderBy(quizOptions.id)
    .all();

  const questionsWithOptions = questions.map((question) => ({
    ...question,
    options: options.filter((o) => o.questionId === question.id),
  }));

  return { ...quiz, questions: questionsWithOptions };
}

export function getBestAttempt(userId: number, quizId: number) {
  return db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}

export function calculateGrade(score: number): string {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export type QuestionResult = {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
};

export type QuizAttemptResult = {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: string;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
};

export type QuizSubmission = {
  userId: number;
  quizId: number;
  // Option id the Student picked, keyed by question id.
  selectedAnswers: Record<number, number>;
};

// Grades the Student's answers and records the attempt. The caller has already
// checked that the quiz exists and belongs to the lesson.
export function submitQuizAttempt(
  database: Db,
  submission: QuizSubmission
): QuizAttemptResult {
  const questionResults = gradeAnswers(database, submission);
  const correct = questionResults.filter((r) => r.correct).length;
  const total = questionResults.length;
  const score = total > 0 ? correct / total : 0;
  const passed = score > 0.7;

  const attemptId = recordAttempt(database, submission, {
    score,
    passed,
    questionResults,
  });

  return {
    attemptId,
    score,
    passed,
    grade: calculateGrade(score),
    totalCorrect: correct,
    totalQuestions: total,
    questionResults,
  };
}

function gradeAnswers(
  database: Db,
  { quizId, selectedAnswers }: QuizSubmission
): QuestionResult[] {
  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  const correctOptions = database
    .select({ id: quizOptions.id, questionId: quizOptions.questionId })
    .from(quizOptions)
    .where(
      and(
        inArray(
          quizOptions.questionId,
          questions.map((q) => q.id)
        ),
        eq(quizOptions.isCorrect, true)
      )
    )
    .all();

  return questions.map((q) => {
    const selected = selectedAnswers[q.id];
    if (!selected) {
      return {
        questionId: q.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      };
    }
    const correctOptionId =
      correctOptions.find((o) => o.questionId === q.id)?.id ?? null;
    return {
      questionId: q.id,
      correct: selected === correctOptionId,
      selectedOptionId: selected,
      correctOptionId,
    };
  });
}

// The attempt and its answers land together or not at all.
function recordAttempt(
  database: Db,
  { userId, quizId }: QuizSubmission,
  graded: Pick<QuizAttemptResult, "score" | "passed" | "questionResults">
): number {
  return database.transaction((tx) => {
    const attempt = tx
      .insert(quizAttempts)
      .values({ userId, quizId, score: graded.score, passed: graded.passed })
      .returning()
      .get();

    const answers = graded.questionResults.flatMap((r) =>
      r.selectedOptionId === null
        ? []
        : [
            {
              attemptId: attempt.id,
              questionId: r.questionId,
              selectedOptionId: r.selectedOptionId,
            },
          ]
    );
    if (answers.length > 0) tx.insert(quizAnswers).values(answers).run();

    return attempt.id;
  });
}
