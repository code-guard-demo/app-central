'use strict';

// Approximate per-1M-token USD pricing for benchmark reporting.
const PRICING_PER_M = {
  claude: { in: 3.0, out: 15.0 },
  gemini: { in: 0.30, out: 2.50 },
};

function estimateCostUsd(provider, inputTokens = 0, outputTokens = 0) {
  const rate = PRICING_PER_M[provider] || { in: 0, out: 0 };
  return (inputTokens * rate.in + outputTokens * rate.out) / 1_000_000;
}

/**
 * Scores a set of benchmark predictions against expected bugs using 1-to-1 matching
 * within `lineTolerance` lines on the matching file path.
 */
function scoreRun(cases, resultsById, lineTolerance = 2) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let latencySum = 0;
  let costSum = 0;
  let totalTokens = 0;
  let parseErrors = 0;
  const perCase = [];

  for (const c of cases) {
    const res = resultsById[c.id] || { findings: [], latencyMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, parseOk: true };
    if (res.parseOk === false) parseErrors++;
    latencySum += res.latencyMs || 0;
    costSum += res.costUsd || 0;
    totalTokens += (res.inputTokens || 0) + (res.outputTokens || 0);

    const matched = new Set();
    let caseTp = 0;
    let caseFp = 0;
    for (const f of res.findings || []) {
      const idx = c.expected.findIndex(
        (exp, i) => !matched.has(i) && exp.file === f.file && Math.abs(f.line - exp.line) <= lineTolerance
      );
      if (idx !== -1) {
        matched.add(idx);
        caseTp++;
      } else {
        caseFp++;
      }
    }
    const caseFn = c.expected.length - matched.size;
    tp += caseTp;
    fp += caseFp;
    fn += caseFn;
    perCase.push({ id: c.id, tp: caseTp, fp: caseFp, fn: caseFn, latencyMs: res.latencyMs || 0, costUsd: res.costUsd || 0 });
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const n = cases.length || 1;

  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    avgLatencyMs: latencySum / n,
    avgCostUsd: costSum / n,
    totalCostUsd: costSum,
    totalTokens,
    parseErrors,
    perCase,
  };
}

module.exports = { scoreRun, estimateCostUsd };
