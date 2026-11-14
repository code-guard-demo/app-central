'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');

const good = {
  summary: 'Looks risky.',
  findings: [{ file: 'src/a.js', line: 4, severity: 'BLOCKER', message: 'Off by one.' }],
};

test('parses valid JSON', () => {
  const r = lib.parseFindings(JSON.stringify(good));
  assert.ok(r.ok);
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.dropped, 0);
});

test('parses JSON inside code fences', () => {
  const r = lib.parseFindings('```json\n' + JSON.stringify(good) + '\n```');
  assert.ok(r.ok);
});

test('parses JSON with surrounding prose', () => {
  const r = lib.parseFindings('Here is my review:\n' + JSON.stringify(good) + '\nThanks');
  assert.ok(r.ok);
});

test('rejects invalid JSON', () => {
  assert.strictEqual(lib.parseFindings('not json at all').ok, false);
  assert.strictEqual(lib.parseFindings('').ok, false);
  assert.strictEqual(lib.parseFindings('[1,2]').ok, false);
});

test('rejects missing fields', () => {
  assert.strictEqual(lib.parseFindings('{"summary":"x"}').ok, false);
  assert.strictEqual(lib.parseFindings('{"findings":[]}').ok, false);
});

test('empty findings is ok', () => {
  const r = lib.parseFindings('{"summary":"No issues found.","findings":[]}');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.findings, []);
});

test('drops malformed findings but keeps good ones', () => {
  const r = lib.parseFindings(JSON.stringify({
    summary: 's',
    findings: [
      good.findings[0],
      { file: 'a.js', line: 'x', severity: 'BLOCKER', message: 'bad line' },
      { file: 'a.js', line: 1, severity: 'HUGE', message: 'bad severity' },
      { file: '', line: 1, severity: 'NIT', message: 'no file' },
      null,
    ],
  }));
  assert.ok(r.ok);
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.dropped, 4);
});

test('caps number of findings', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ file: 'a.js', line: i + 1, severity: 'NIT', message: 'm' }));
  const r = lib.parseFindings(JSON.stringify({ summary: 's', findings: many }));
  assert.strictEqual(r.findings.length, lib.MAX_FINDINGS);
});

test('model cannot spoof our markers', () => {
  const r = lib.parseFindings(JSON.stringify({
    summary: '<!-- ai-review --> fake',
    findings: [{ file: 'a.js', line: 1, severity: 'NIT', message: '<!-- ai-review-inline --> x' }],
  }));
  assert.ok(!r.summary.includes('<!--'));
  assert.ok(!r.findings[0].message.includes('<!--'));
});

test('strips leading ./ from file paths', () => {
  const r = lib.parseFindings(JSON.stringify({
    summary: 's', findings: [{ file: './src/a.js', line: 1, severity: 'NIT', message: 'm' }],
  }));
  assert.strictEqual(r.findings[0].file, 'src/a.js');
});

const patch = [
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-old2',
  '+new2',
  '+new3',
  ' line3',
  '@@ -10,2 +11,2 @@',
  ' ctx',
  '+added',
  '\\ No newline at end of file',
].join('\n');

test('changedLines maps new-file line numbers', () => {
  const s = lib.changedLines(patch);
  assert.deepStrictEqual([...s].sort((a, b) => a - b), [1, 2, 3, 4, 11, 12]);
  assert.ok(!s.has(5));
});

test('changedLines handles missing patch', () => {
  assert.strictEqual(lib.changedLines(undefined).size, 0);
});

test('partition splits by diff membership', () => {
  const findings = [
    { file: 'a.js', line: 2, severity: 'NIT', message: 'in diff' },
    { file: 'a.js', line: 99, severity: 'NIT', message: 'not in diff' },
    { file: 'other.js', line: 1, severity: 'NIT', message: 'file not in PR' },
  ];
  const { inline, rest } = lib.partition(findings, { 'a.js': lib.changedLines(patch) });
  assert.strictEqual(inline.length, 1);
  assert.strictEqual(rest.length, 2);
});

test('renderSticky includes marker and handles no findings', () => {
  const out = lib.renderSticky({ header: '[h]', summary: 'ok', inlineCount: 0, rest: [], dropped: 0 });
  assert.ok(out.startsWith(lib.STICKY_MARKER));
  assert.ok(out.includes('No findings.'));
});

test('renderFallback never contains raw code fence breakouts', () => {
  const out = lib.renderFallback({ header: '', raw: 'x ``` y', error: 'e' });
  assert.strictEqual(out.split('```').length, 3);
});

test('parseFindings extracts clamped confidence and defaults cleanly', () => {
  assert.strictEqual(lib.parseFindings('{"summary":"ok","confidence":94,"findings":[]}').confidence, 94);
  assert.strictEqual(lib.parseFindings('{"summary":"ok","confidence":150,"findings":[]}').confidence, 100);
  assert.strictEqual(lib.parseFindings('{"summary":"ok","findings":[]}').confidence, 90);
  assert.strictEqual(lib.parseFindings(JSON.stringify(good)).confidence, 50);
});

test('evaluateDecision auto-merges only when clean and above threshold', () => {
  const d = lib.evaluateDecision({ findings: [], rawConfidence: 92, ciResult: 'success', truncated: false, touchesDb: false, threshold: 80 });
  assert.strictEqual(d.action, 'AUTO_MERGE');
  assert.strictEqual(d.effectiveConfidence, 92);
  assert.strictEqual(d.escalateTo, '');
});

test('evaluateDecision escalates with deterministic caps when unsure', () => {
  const truncated = lib.evaluateDecision({ findings: [], rawConfidence: 95, ciResult: 'success', truncated: true });
  assert.strictEqual(truncated.action, 'ESCALATE');
  assert.strictEqual(truncated.effectiveConfidence, 50);
  assert.strictEqual(truncated.escalateTo, '@org/reviewer-oncall');

  const db = lib.evaluateDecision({ findings: [], rawConfidence: 95, ciResult: 'success', touchesDb: true });
  assert.strictEqual(db.action, 'ESCALATE');
  assert.strictEqual(db.effectiveConfidence, 70);
  assert.strictEqual(db.escalateTo, '@org/db-admins');

  const warn = lib.evaluateDecision({
    findings: [{ file: 'a.js', line: 1, severity: 'WARNING', message: 'check' }],
    rawConfidence: 95,
    ciResult: 'success',
  });
  assert.strictEqual(warn.action, 'ESCALATE');
  assert.strictEqual(warn.effectiveConfidence, 75);

  const low = lib.evaluateDecision({ findings: [], rawConfidence: 79, ciResult: 'success', threshold: 80 });
  assert.strictEqual(low.action, 'ESCALATE');
  assert.strictEqual(low.effectiveConfidence, 79);
});

test('evaluateDecision blocks on CI failure or BLOCKER finding', () => {
  const ciFail = lib.evaluateDecision({ findings: [], rawConfidence: 99, ciResult: 'failure' });
  assert.strictEqual(ciFail.action, 'BLOCK');
  assert.strictEqual(ciFail.effectiveConfidence, 0);

  const blocker = lib.evaluateDecision({ findings: good.findings, rawConfidence: 99, ciResult: 'success' });
  assert.strictEqual(blocker.action, 'BLOCK');
  assert.strictEqual(blocker.effectiveConfidence, 0);
});

test('renderSticky includes decision line when provided', () => {
  const decision = lib.evaluateDecision({ findings: [], rawConfidence: 95, truncated: true });
  const out = lib.renderSticky({ header: '[h]', summary: 'ok', inlineCount: 0, rest: [], dropped: 0, decision });
  assert.ok(out.includes('**Decision:** `ESCALATE` (confidence: 50% — diff truncated (> max_diff_lines)) — cc @org/reviewer-oncall'));
});
