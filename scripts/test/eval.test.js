'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreRun, estimateCostUsd } = require('../../eval/score');

const cases = [
  { id: 'c1', expected: [{ file: 'a.js', line: 10 }] },
  { id: 'c2', expected: [] },
];

test('scoreRun counts exact and tolerant line matches as TP', () => {
  const s = scoreRun(cases, {
    c1: { findings: [{ file: 'a.js', line: 12 }], latencyMs: 100, costUsd: 0.01, inputTokens: 10, outputTokens: 5 },
    c2: { findings: [], latencyMs: 200, costUsd: 0.02, inputTokens: 20, outputTokens: 5 },
  });
  assert.strictEqual(s.tp, 1);
  assert.strictEqual(s.fp, 0);
  assert.strictEqual(s.fn, 0);
  assert.strictEqual(s.precision, 1);
  assert.strictEqual(s.recall, 1);
  assert.strictEqual(s.avgLatencyMs, 150);
  assert.strictEqual(s.totalTokens, 40);
});

test('scoreRun prevents duplicate findings on one bug from inflating TP', () => {
  const s = scoreRun(cases, {
    c1: { findings: [{ file: 'a.js', line: 10 }, { file: 'a.js', line: 10 }] },
    c2: { findings: [{ file: 'b.js', line: 1 }] },
  });
  assert.strictEqual(s.tp, 1);
  assert.strictEqual(s.fp, 2);
  assert.strictEqual(s.fn, 0);
});

test('scoreRun treats out-of-tolerance or wrong-file findings as FP + FN', () => {
  const s = scoreRun(cases, {
    c1: { findings: [{ file: 'a.js', line: 20 }] },
    c2: { findings: [] },
  });
  assert.strictEqual(s.tp, 0);
  assert.strictEqual(s.fp, 1);
  assert.strictEqual(s.fn, 1);
  assert.strictEqual(s.precision, 0);
  assert.strictEqual(s.recall, 0);
});

test('estimateCostUsd returns non-negative numbers', () => {
  assert.ok(estimateCostUsd('claude', 1000, 500) > 0);
  assert.ok(estimateCostUsd('gemini', 1000, 500) > 0);
});
