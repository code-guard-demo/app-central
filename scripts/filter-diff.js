#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const IGNORE_RE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(?:js|css)$|(?:^|\/)dist\/|\.generated\.[^/]+$/i;

function isIgnoredPath(filePath) {
  return IGNORE_RE.test(String(filePath || '').trim());
}

function parseSectionPath(section) {
  const firstLine = section.split('\n', 1)[0] || '';
  const m = firstLine.match(/^diff --git a\/.+ b\/(.+)$/);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}

function filterDiff(rawDiff, maxLines = 500) {
  const raw = String(rawDiff || '');
  if (!raw.trim()) {
    return { diff: '', ignored: [], totalLines: 0, keptOriginalLines: 0, keptLines: 0, truncated: false, note: '' };
  }

  const limit = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0 ? Math.floor(Number(maxLines)) : 500;
  const rawSections = raw.split(/^(?=diff --git )/m).filter(Boolean);
  const ignored = [];
  const kept = [];

  for (const text of rawSections) {
    const filePath = parseSectionPath(text);
    if (filePath && isIgnoredPath(filePath)) {
      ignored.push(filePath);
    } else {
      const lines = text.replace(/\n$/, '').split('\n');
      kept.push({ path: filePath || 'unknown', lines });
    }
  }

  const keptOriginalLines = kept.reduce((sum, s) => sum + s.lines.length, 0);
  if (kept.length === 0) {
    const note = ignored.length > 0 ? ` | diff: ignored ${ignored.length}` : '';
    return { diff: '', ignored, totalLines: raw.split('\n').length, keptOriginalLines: 0, keptLines: 0, truncated: false, note };
  }

  let truncated = false;
  let outputSections = kept.map((s) => s.lines);

  if (keptOriginalLines > limit) {
    truncated = true;
    // Allocate smallest files first so one huge file cannot crowd out small bug diffs.
    const order = kept.map((_, i) => i).sort((a, b) => kept[a].lines.length - kept[b].lines.length);
    const allocated = new Array(kept.length);
    let remaining = limit;

    for (let k = 0; k < order.length; k++) {
      const idx = order[k];
      const lines = kept[idx].lines;
      const share = Math.max(1, Math.floor(remaining / (order.length - k)));
      if (lines.length <= share) {
        allocated[idx] = lines;
        remaining -= lines.length;
      } else if (share === 1) {
        allocated[idx] = [`... [truncated ${lines.length} lines in ${kept[idx].path}]`];
        remaining -= 1;
      } else {
        const keepCount = share - 1;
        const dropped = lines.length - keepCount;
        allocated[idx] = [...lines.slice(0, keepCount), `... [truncated ${dropped} lines in ${kept[idx].path}]`];
        remaining -= share;
      }
    }
    outputSections = allocated;
  }

  const diff = outputSections.map((ls) => ls.join('\n')).join('\n') + '\n';
  const keptLines = outputSections.reduce((sum, ls) => sum + ls.length, 0);
  const parts = [];
  if (ignored.length > 0) parts.push(`ignored ${ignored.length}`);
  if (truncated) parts.push(`truncated ${keptOriginalLines}->${keptLines} lines`);
  const note = parts.length > 0 ? ` | diff: ${parts.join(', ')}` : '';

  return {
    diff,
    ignored,
    totalLines: raw.split('\n').length,
    keptOriginalLines,
    keptLines,
    truncated,
    note,
  };
}

if (require.main === module) {
  const [, , inFile, outFile, maxArg] = process.argv;
  if (!inFile || !outFile) {
    console.error('Usage: filter-diff.js <raw.diff> <out.diff> [maxLines]');
    process.exit(2);
  }
  const raw = fs.readFileSync(inFile, 'utf8');
  const res = filterDiff(raw, maxArg ? Number(maxArg) : 500);
  fs.writeFileSync(outFile, res.diff);
  console.log(`Diff lines: raw=${res.totalLines} keptOriginal=${res.keptOriginalLines} final=${res.keptLines} ignored=${res.ignored.length} truncated=${res.truncated}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `diff_note=${res.note}\n`);
  }
}

module.exports = { isIgnoredPath, filterDiff };
