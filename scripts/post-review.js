#!/usr/bin/env node
'use strict';
// Usage: node post-review.js <findings.json>
// Env: GH_TOKEN, REPO, PR_NUMBER, HEAD_SHA, HEADER (optional), DRY_RUN (optional)
const fs = require('node:fs');
const lib = require('./lib');

const {
  GH_TOKEN, REPO, PR_NUMBER, HEAD_SHA, HEADER = '', DRY_RUN,
  CI_RESULT = 'not run',
  TOUCHES_DB = 'false',
  DIFF_TRUNCATED = 'false',
  AUTO_MERGE = 'true',
  SCORE_THRESHOLD = '80',
  ESCALATION_TAG = '@org/reviewer-oncall',
  DB_ESCALATION_TAG = '@org/db-admins',
} = process.env;
const API = 'https://api.github.com';

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function paginate(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const items = await api('GET', `${path}${sep}per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

async function findStickyComment() {
  if (DRY_RUN) return null;
  const comments = await paginate(`/repos/${REPO}/issues/${PR_NUMBER}/comments`);
  return comments.find((c) => c.body && c.body.includes(lib.STICKY_MARKER)) || null;
}

async function upsertSticky(body, existingComment = undefined) {
  if (DRY_RUN) { console.log('--- STICKY ---\n' + body); return; }
  const existing = existingComment === undefined ? await findStickyComment() : existingComment;
  if (existing) await api('PATCH', `/repos/${REPO}/issues/comments/${existing.id}`, { body });
  else await api('POST', `/repos/${REPO}/issues/${PR_NUMBER}/comments`, { body });
}

async function clearOldInlineComments() {
  try {
    const old = await paginate(`/repos/${REPO}/pulls/${PR_NUMBER}/comments`);
    for (const c of old.filter((c) => c.body && c.body.includes(lib.INLINE_MARKER))) {
      await api('DELETE', `/repos/${REPO}/pulls/comments/${c.id}`).catch((e) => console.log(`::warning::${e.message}`));
    }
  } catch (e) { console.log(`::warning::cleanup failed: ${e.message}`); }
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.log(`::warning::No findings file at ${file}; reviewer produced no output.`);
    await upsertSticky(lib.renderFallback({ header: HEADER, raw: '(no output)', error: 'file missing' }));
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = lib.parseFindings(raw);
  if (!parsed.ok) {
    console.log(`::warning::Unparseable review output: ${parsed.error}`);
    await upsertSticky(lib.renderFallback({ header: HEADER, raw, error: parsed.error }));
    return;
  }

  const parsedThreshold = Number(SCORE_THRESHOLD);
  const threshold = Number.isFinite(parsedThreshold) ? parsedThreshold : 80;
  const decision = lib.evaluateDecision({
    findings: parsed.findings,
    rawConfidence: parsed.confidence,
    ciResult: CI_RESULT,
    truncated: DIFF_TRUNCATED === 'true',
    touchesDb: TOUCHES_DB === 'true',
    threshold,
    escalationTag: ESCALATION_TAG,
    dbEscalationTag: DB_ESCALATION_TAG,
  });

  if (decision.action === 'AUTO_MERGE') {
    if (!DRY_RUN) {
      await clearOldInlineComments();
      const existing = await findStickyComment();
      if (existing) {
        await upsertSticky(lib.renderSticky({
          header: HEADER, summary: parsed.summary, inlineCount: 0, rest: parsed.findings, dropped: parsed.dropped, decision,
        }), existing);
      }
      if (AUTO_MERGE === 'true') {
        try {
          await api('PUT', `/repos/${REPO}/pulls/${PR_NUMBER}/merge`, {
            merge_method: 'squash',
            sha: HEAD_SHA,
          });
          console.log(`Auto-merged PR #${PR_NUMBER} (confidence ${decision.effectiveConfidence}% > ${decision.threshold}%).`);
        } catch (e) {
          console.log(`::warning::Auto-merge skipped/failed: ${e.message}`);
        }
      }
    } else {
      console.log(`--- AUTO_MERGE (silent: ${decision.effectiveConfidence}% > ${decision.threshold}%) ---`);
    }
    return;
  }

  let inline = [];
  let rest = parsed.findings;
  if (!DRY_RUN) {
    const files = await paginate(`/repos/${REPO}/pulls/${PR_NUMBER}/files`);
    const diffMap = {};
    for (const f of files) diffMap[f.filename] = lib.changedLines(f.patch);
    ({ inline, rest } = lib.partition(parsed.findings, diffMap));

    await clearOldInlineComments();

    if (inline.length > 0) {
      try {
        await api('POST', `/repos/${REPO}/pulls/${PR_NUMBER}/reviews`, {
          commit_id: HEAD_SHA,
          event: 'COMMENT',
          comments: inline.map((f) => ({ path: f.file, line: f.line, side: 'RIGHT', body: lib.renderInline(f) })),
        });
      } catch (e) {
        console.log(`::warning::inline review failed, folding into summary: ${e.message}`);
        rest = parsed.findings;
        inline = [];
      }
    }
  }

  await upsertSticky(lib.renderSticky({
    header: HEADER, summary: parsed.summary, inlineCount: inline.length, rest, dropped: parsed.dropped, decision,
  }));
}

main().catch((e) => {
  // Never fail the PR because the reviewer's output could not be posted.
  console.log(`::warning::post-review failed: ${e.message}`);
});
