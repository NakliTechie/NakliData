export type RegexSafetyResult = { safe: true } | { safe: false; reason: string };

const MAX_PATTERN_LENGTH = 256;
const MAX_GROUP_DEPTH = 8;
const MAX_QUANTIFIERS = 32;

/**
 * Conservative admission check for user-authored regular expressions.
 *
 * JavaScript RegExp has no execution deadline. User patterns therefore accept
 * a deliberately smaller language: no backreferences/lookbehind, no repeated
 * groups containing alternation or another quantifier, and bounded structural
 * complexity. This rejects common catastrophic-backtracking shapes before
 * they can enter the taxonomy worker.
 */
export function validateSafeRegexPattern(pattern: string): RegexSafetyResult {
  if (pattern.length === 0) return { safe: false, reason: 'pattern is empty' };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `pattern exceeds ${MAX_PATTERN_LENGTH} characters`,
    };
  }
  try {
    new RegExp(pattern);
  } catch (err) {
    return {
      safe: false,
      reason: `pattern is invalid: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (/\\(?:[1-9]|k<)/.test(pattern)) {
    return { safe: false, reason: 'backreferences are not allowed' };
  }
  if (/\(\?<([=!])/.test(pattern)) {
    return { safe: false, reason: 'lookbehind assertions are not allowed' };
  }

  const groups: Array<{ hasAlternation: boolean; hasQuantifier: boolean }> = [];
  let inClass = false;
  let escaped = false;
  let quantifiers = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if (char === '(') {
      groups.push({ hasAlternation: false, hasQuantifier: false });
      if (groups.length > MAX_GROUP_DEPTH) {
        return { safe: false, reason: `group nesting exceeds ${MAX_GROUP_DEPTH}` };
      }
      continue;
    }
    if (char === '|') {
      const current = groups.at(-1);
      if (current) current.hasAlternation = true;
      continue;
    }

    const prior = pattern[i - 1];
    const isQuestionQuantifier =
      char === '?' &&
      prior !== '(' &&
      prior !== '*' &&
      prior !== '+' &&
      prior !== '?' &&
      prior !== '}';
    const isSimpleQuantifier = char === '*' || char === '+' || isQuestionQuantifier;
    const isBraceQuantifier = char === '{' && /^\{\d+(?:,\d*)?\}/.test(pattern.slice(i));
    if (isSimpleQuantifier || isBraceQuantifier) {
      quantifiers += 1;
      if (quantifiers > MAX_QUANTIFIERS) {
        return { safe: false, reason: `pattern exceeds ${MAX_QUANTIFIERS} quantifiers` };
      }
      const current = groups.at(-1);
      if (current) current.hasQuantifier = true;
      continue;
    }

    if (char === ')') {
      const group = groups.pop();
      if (!group) continue;
      const suffix = pattern.slice(i + 1);
      const groupIsRepeated = /^(?:[*+]|\{\d+(?:,\d*)?\})/.test(suffix);
      if (groupIsRepeated && (group.hasAlternation || group.hasQuantifier)) {
        return {
          safe: false,
          reason: 'repeated groups cannot contain alternation or another quantifier',
        };
      }
      if (group.hasAlternation || group.hasQuantifier) {
        const parent = groups.at(-1);
        if (parent) {
          parent.hasAlternation ||= group.hasAlternation;
          parent.hasQuantifier ||= group.hasQuantifier;
        }
      }
    }
  }
  return { safe: true };
}

export function assertSafeRegexPattern(pattern: string): void {
  const result = validateSafeRegexPattern(pattern);
  if (!result.safe) throw new Error(`Unsafe regular expression: ${result.reason}.`);
}
