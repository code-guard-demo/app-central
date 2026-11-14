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
