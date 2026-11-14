'use strict';

const SEVERITIES = ['BLOCKER', 'WARNING', 'NIT'];
const MAX_FINDINGS = 20;
const INLINE_MARKER = '<!-- ai-review-inline -->';
const STICKY_MARKER = '<!-- ai-review -->';

// Model output is untrusted: stop it from spoofing our markers.
function sanitize(text) {
  return String(text).replace(/<!--/g, '&lt;!--').trim();
}

function extractJson(text) {
  const t = String(text).trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : t;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch (_) { /* fall through */ }
    }
  }
  return undefined;
}

// Returns { ok, summary, findings, dropped, error }
function parseFindings(text) {
  const data = extractJson(text);
  if (data === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'not a JSON object', findings: [], dropped: 0 };
  }
  if (typeof data.summary !== 'string' || !Array.isArray(data.findings)) {
    return { ok: false, error: 'missing summary or findings', findings: [], dropped: 0 };
  }
  const findings = [];
  let dropped = 0;
  for (const f of data.findings) {
    const valid =
      f && typeof f === 'object' &&
      typeof f.file === 'string' && f.file.length > 0 &&
      Number.isInteger(f.line) && f.line > 0 &&
      SEVERITIES.includes(f.severity) &&
      typeof f.message === 'string' && f.message.trim().length > 0;
    if (!valid || findings.length >= MAX_FINDINGS) { dropped++; continue; }
    findings.push({
      file: f.file.replace(/^\.?\//, ''),
      line: f.line,
      severity: f.severity,
      message: sanitize(f.message),
    });
  }
  return { ok: true, summary: sanitize(data.summary), findings, dropped };
}

// Set of new-file line numbers visible in a unified-diff patch (RIGHT side).
function changedLines(patch) {
  const lines = new Set();
  if (!patch) return lines;
  let newLine = 0;
  for (const row of patch.split('\n')) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { newLine = parseInt(hunk[1], 10); continue; }
    if (newLine === 0) continue;
    if (row.startsWith('-')) continue;          // removed line: no new line number
    if (row.startsWith('\\')) continue;         // "\ No newline at end of file"
    lines.add(newLine);                         // '+' or context line
    newLine++;
  }
  return lines;
}

// diffMap: { path: Set<line> }. Splits findings into inline-able and the rest.
function partition(findings, diffMap) {
  const inline = [];
  const rest = [];
  for (const f of findings) {
    const set = diffMap[f.file];
    (set && set.has(f.line) ? inline : rest).push(f);
  }
  return { inline, rest };
}

function formatFinding(f) {
  return `**[${f.severity}]** \`${f.file}:${f.line}\`: ${f.message}`;
}

function renderSticky({ header, summary, inlineCount, rest, dropped }) {
  const out = [STICKY_MARKER];
  if (header) out.push(header);
  out.push('', '## Summary', summary);
  if (inlineCount > 0) out.push('', `${inlineCount} finding(s) posted as inline comments.`);
  if (rest.length > 0) {
    out.push('', '## Findings');
    for (const f of rest) out.push(`- ${formatFinding(f)}`);
  }
  if (inlineCount === 0 && rest.length === 0) out.push('', 'No findings.');
  if (dropped > 0) out.push('', `_${dropped} malformed finding(s) were ignored._`);
  return out.join('\n');
}

function renderFallback({ header, raw, error }) {
  const clipped = String(raw).slice(0, 4000).replace(/```/g, "'''");
  return [
    STICKY_MARKER,
    header || '',
    '',
    `> Could not parse structured review output (${error}). Raw output below.`,
    '',
    '```',
    clipped,
    '```',
  ].join('\n');
}

function renderInline(f) {
  return `${INLINE_MARKER}\n${formatFinding(f).replace(/^\*\*\[/, '**[')}`;
}

module.exports = {
  SEVERITIES, MAX_FINDINGS, INLINE_MARKER, STICKY_MARKER,
  parseFindings, changedLines, partition,
  renderSticky, renderFallback, renderInline,
};
