/**
 * Parse the first complete JSON object from a model response.
 *
 * Small instruction-tuned models often emit a valid object and then append a
 * sentence despite an explicit JSON-only prompt. The job-specific parsers
 * still validate every accepted field after this boundary; this helper only
 * recovers the bounded object envelope. It never repairs malformed or
 * truncated JSON.
 */
export function parseFirstJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const input = fenced || trimmed;
  if (!input.startsWith('{')) {
    // Keep prose-preface rejection intact. Recovery exists only for a JSON
    // object that starts the response or occupies the first fenced block.
    JSON.parse(input);
    throw new SyntaxError('Sidecar response did not contain a JSON object.');
  }

  const start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const char = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;

    const parsed = JSON.parse(input.slice(start, i + 1)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SyntaxError('Sidecar response did not contain a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }

  // Preserve JSON.parse's precise diagnostic for malformed or truncated
  // responses. Job parsers wrap it in the public SidecarError shape.
  const parsed = JSON.parse(input) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError('Sidecar response did not contain a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
