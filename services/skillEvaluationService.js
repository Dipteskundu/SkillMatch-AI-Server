/**
 * Evaluate MCQ answers deterministically.
 * This keeps scoring fair, predictable, and less strict for candidates.
 */
async function evaluateSkillAnswers(skillsArray, questions, answers) {
  const answerMap = new Map(
    (Array.isArray(answers) ? answers : []).map((a) => [a.questionId, String(a.answer || "").trim()]),
  );
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const totalQuestions = safeQuestions.length || 1;

  let correctCount = 0;
  for (const q of safeQuestions) {
    const expected = String(q.correctAnswer || "").trim().toLowerCase();
    const given = (answerMap.get(q.id) || "").toLowerCase();
    if (expected && given && expected === given) {
      correctCount += 1;
    }
  }

  const score = Math.round((correctCount / totalQuestions) * 100);
  const skillsList = Array.isArray(skillsArray) ? skillsArray.join(", ") : String(skillsArray || "skills");
  const feedback =
    score >= 80
      ? `Great work. You answered ${correctCount}/${totalQuestions} correctly across ${skillsList}.`
      : score >= 60
        ? `Good effort. You answered ${correctCount}/${totalQuestions} correctly. Review missed basics and retry to improve.`
        : `You answered ${correctCount}/${totalQuestions} correctly. Focus on fundamentals for ${skillsList} and try again.`;

  return {
    score,
    feedback,
    passed: score >= 60,
  };
}

export { evaluateSkillAnswers };
export default { evaluateSkillAnswers };
