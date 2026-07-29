export interface EvidenceLabel {
  summary: string;
  technical: string;
}

/**
 * Translate detector implementation strings into analyst-facing evidence.
 * The untouched detector output remains available as `technical`.
 */
export function humanizeEvidence(technical: string): EvidenceLabel {
  let match = technical.match(/^header == "(.+)"$/);
  if (match?.[1]) {
    return { summary: `Column name exactly matches “${match[1]}”.`, technical };
  }
  match = technical.match(/^header ≡ "(.+)" \(ignoring separators\)$/);
  if (match?.[1]) {
    return {
      summary: `Column name matches “${match[1]}” when separators are ignored.`,
      technical,
    };
  }
  match = technical.match(/^header contains "(.+)"$/);
  if (match?.[1]) {
    return { summary: `Column name contains the expected terms for “${match[1]}”.`, technical };
  }
  match = technical.match(/^header token-run "(.+)"$/);
  if (match?.[1]) {
    return { summary: `Adjacent words in the column name match “${match[1]}”.`, technical };
  }
  match = technical.match(/^regex match (\d+)% \((\d+)\/(\d+)\)$/);
  if (match?.[1]) {
    return {
      summary: `${match[1]}% of sampled values match the expected format.`,
      technical,
    };
  }
  match = technical.match(/^(.+) valid (\d+)% \((\d+)\/(\d+)\)$/);
  if (match?.[1] && match[2]) {
    return {
      summary: `${match[2]}% of sampled values pass the ${match[1]} validation check.`,
      technical,
    };
  }
  match = technical.match(/^value-set match (\d+)% \((\d+)\/(\d+)\)$/);
  if (match?.[1]) {
    return { summary: `${match[1]}% of sampled values match known examples.`, technical };
  }
  match = technical.match(
    /^in \[([^,]+), ([^\]]+)\]: (\d+)% of numeric values \((\d+)\/(\d+) parsed; (\d+) total\)$/,
  );
  if (match?.[1] && match[2] && match[3]) {
    return {
      summary: `${match[3]}% of numeric values fall within the expected ${match[1]}–${match[2]} range.`,
      technical,
    };
  }
  if (technical === 'no numeric values') {
    return { summary: 'No sampled values could be read as numbers.', technical };
  }

  const distribution: string[] = [];
  const cardinality = technical.match(/cardinality (\d+)%/);
  if (cardinality?.[1]) distribution.push(`Sample values are ${cardinality[1]}% distinct.`);
  const numeric = technical.match(/numeric (\d+)% \((\d+)\/(\d+) non-blank\)/);
  if (numeric?.[1]) {
    distribution.push(`${numeric[1]}% of non-blank sampled values are numeric.`);
  }
  const length = technical.match(/length∈\[([^,]+),([^\]]+)\] (\d+)%/);
  if (length?.[1] && length[2] && length[3]) {
    return {
      summary: [
        ...distribution,
        `${length[3]}% of sampled values have the expected ${length[1]}–${length[2]} character length.`,
      ].join(' '),
      technical,
    };
  }
  if (distribution.length > 0) return { summary: distribution.join(' '), technical };

  return {
    summary: 'A classification detector found supporting evidence.',
    technical,
  };
}
