export const COMPANION_MODES = ['hint', 'explain', 'quiz', 'chat'] as const;
export type CompanionMode = typeof COMPANION_MODES[number];
export type CompanionQuiz = {question: string; options: string[]; correct: number; explanation: string};
export const isCompanionMode = (value: unknown): value is CompanionMode => COMPANION_MODES.includes(value as CompanionMode);

/** Reject incomplete model output instead of displaying an unanswerable exercise. */
export function parseCompanionQuiz(value: unknown): CompanionQuiz | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); }
    catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.question !== 'string' || !candidate.question.trim() || candidate.question.length > 1000) return null;
  if (!Array.isArray(candidate.options) || candidate.options.length !== 4 || candidate.options.some(v => typeof v !== 'string' || !v.trim() || v.length > 500)) return null;
  const options = (candidate.options as string[]).map(v => v.trim().replace(/^[A-D][.)、]\s*/i, ''));
  if (options.some(option => !option.trim()) || new Set(options).size !== 4) return null;
  const rawCorrect = candidate.correct;
  const correct = typeof rawCorrect === 'number' ? rawCorrect : typeof rawCorrect === 'string' && /^[A-D]$/i.test(rawCorrect.trim()) ? rawCorrect.trim().toUpperCase().charCodeAt(0) - 65 : NaN;
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
  if (typeof candidate.explanation !== 'string' || !candidate.explanation.trim() || candidate.explanation.length > 2000) return null;
  return {question: candidate.question.trim(), options, correct, explanation: candidate.explanation.trim()};
}
