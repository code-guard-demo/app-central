'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isIgnoredPath, filterDiff } = require('../filter-diff');

test('isIgnoredPath matches lockfiles, minified, dist, and generated files', () => {
  assert.ok(isIgnoredPath('package-lock.json'));
  assert.ok(isIgnoredPath('web/yarn.lock'));
  assert.ok(isIgnoredPath('pnpm-lock.yaml'));
  assert.ok(isIgnoredPath('dist/bundle.js'));
  assert.ok(isIgnoredPath('src/foo.min.js'));
  assert.ok(isIgnoredPath('src/schema.generated.ts'));
  assert.strictEqual(isIgnoredPath('src/sum.js'), false);
});

test('filterDiff strips lockfiles and preserves small bug file when large file exceeds limit', () => {
  const lock = 'diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1,1 +1,2 @@\n+{"lockfileVersion":3}\n';
  const bigLines = Array.from({ length: 1000 }, (_, i) => `+const x${i} = ${i};`).join('\n');
  const big = `diff --git a/big.js b/big.js\n--- /dev/null\n+++ b/big.js\n@@ -0,0 +1,1000 @@\n${bigLines}\n`;
  const small = 'diff --git a/sum.js b/sum.js\n--- a/sum.js\n+++ b/sum.js\n@@ -1,3 +1,3 @@\n-for (let i = 0; i < n; i++)\n+for (let i = 0; i <= n; i++)\n';

  const res = filterDiff(lock + big + small, 100);
  assert.deepStrictEqual(res.ignored, ['package-lock.json']);
  assert.strictEqual(res.truncated, true);
  assert.ok(res.keptLines <= 100);
  assert.ok(!res.diff.includes('package-lock.json'));
  assert.ok(res.diff.includes('i <= n'), 'small file diff must survive truncation');
  assert.ok(res.diff.includes('truncated'), 'large file truncation marker expected');
  assert.ok(res.note.includes('ignored 1') && res.note.includes('truncated'));
});

test('filterDiff returns empty note when under limit with no ignored files', () => {
  const small = 'diff --git a/sum.js b/sum.js\n--- a/sum.js\n+++ b/sum.js\n@@ -1 +1 @@\n-a\n+b\n';
  const res = filterDiff(small, 500);
  assert.strictEqual(res.truncated, false);
  assert.deepStrictEqual(res.ignored, []);
  assert.strictEqual(res.note, '');
});
