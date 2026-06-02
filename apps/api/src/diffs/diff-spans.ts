import type { Span } from '../db/schema';

export type SpanDiffStatus = 'matched' | 'diverged' | 'only_in_a' | 'only_in_b';

export interface SpanDiff {
  name: string;
  kind: string;
  status: SpanDiffStatus;
  a?: SpanSummary;
  b?: SpanSummary;
  differences: Record<string, FieldDiff>;
}

export interface SpanSummary {
  id: string;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  has_error: boolean;
}

export type FieldDiff =
  | { kind: 'delta'; a: number; b: number; delta_pct: number }
  | { kind: 'changed'; a: unknown; b: unknown }
  | { kind: 'added'; b: unknown }
  | { kind: 'removed'; a: unknown };

export interface DiffResult {
  spans: SpanDiff[];
  summary: {
    matched_count: number;
    diverged_count: number;
    only_in_a_count: number;
    only_in_b_count: number;
    total_duration_a_ms: number;
    total_duration_b_ms: number;
    total_duration_delta_ms: number;
  };
}

const SIGNIFICANT_DELTA_PCT = 10; // duration deltas under 10% don't count as "diverged"

export function diffSpans(spansA: Span[], spansB: Span[]): DiffResult {
  // Group by name, preserving order within each group
  const groupA = groupByName(spansA);
  const groupB = groupByName(spansB);

  const allNames = new Set([...groupA.keys(), ...groupB.keys()]);
  const result: SpanDiff[] = [];

  for (const name of allNames) {
    const listA = groupA.get(name) ?? [];
    const listB = groupB.get(name) ?? [];
    const maxLen = Math.max(listA.length, listB.length);

    for (let i = 0; i < maxLen; i++) {
      const a = listA[i];
      const b = listB[i];

      if (a && !b) {
        result.push({
          name,
          kind: a.kind,
          status: 'only_in_a',
          a: summarize(a),
          differences: {},
        });
      } else if (!a && b) {
        result.push({
          name,
          kind: b.kind,
          status: 'only_in_b',
          b: summarize(b),
          differences: {},
        });
      } else if (a && b) {
        const differences = compareSpans(a, b);
        const isDiverged = Object.keys(differences).length > 0;
        result.push({
          name,
          kind: a.kind,
          status: isDiverged ? 'diverged' : 'matched',
          a: summarize(a),
          b: summarize(b),
          differences,
        });
      }
    }
  }

  // Sort by execution order (use the earliest startedAt across A and B)
  result.sort((x, y) => {
    const ax = listEarliest(x.a, spansA, x.name);
    const ay = listEarliest(y.a, spansA, y.name);
    return ax - ay;
  });

  const totalA = sumDurations(spansA);
  const totalB = sumDurations(spansB);

  return {
    spans: result,
    summary: {
      matched_count: result.filter((s) => s.status === 'matched').length,
      diverged_count: result.filter((s) => s.status === 'diverged').length,
      only_in_a_count: result.filter((s) => s.status === 'only_in_a').length,
      only_in_b_count: result.filter((s) => s.status === 'only_in_b').length,
      total_duration_a_ms: totalA,
      total_duration_b_ms: totalB,
      total_duration_delta_ms: totalB - totalA,
    },
  };
}

function groupByName(spans: Span[]): Map<string, Span[]> {
  const out = new Map<string, Span[]>();
  for (const span of spans) {
    const list = out.get(span.name) ?? [];
    list.push(span);
    out.set(span.name, list);
  }
  return out;
}

function summarize(span: Span): SpanSummary {
  const duration = span.endedAt
    ? new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
    : 0;
  return {
    id: span.id,
    duration_ms: duration,
    tokens_in: span.tokensIn,
    tokens_out: span.tokensOut,
    cost_usd: span.costUsd !== null ? Number(span.costUsd) : null,
    has_error: span.error !== null,
  };
}

function compareSpans(a: Span, b: Span): Record<string, FieldDiff> {
  const diffs: Record<string, FieldDiff> = {};

  const durA = summarize(a).duration_ms;
  const durB = summarize(b).duration_ms;
  if (durA > 0 || durB > 0) {
    const base = Math.max(durA, 1);
    const deltaPct = ((durB - durA) / base) * 100;
    if (Math.abs(deltaPct) >= SIGNIFICANT_DELTA_PCT) {
      diffs.duration_ms = {
        kind: 'delta',
        a: durA,
        b: durB,
        delta_pct: deltaPct,
      };
    }
  }

  if ((a.tokensIn ?? 0) !== (b.tokensIn ?? 0)) {
    diffs.tokens_in = { kind: 'changed', a: a.tokensIn, b: b.tokensIn };
  }
  if ((a.tokensOut ?? 0) !== (b.tokensOut ?? 0)) {
    diffs.tokens_out = { kind: 'changed', a: a.tokensOut, b: b.tokensOut };
  }

  const aHasError = a.error !== null;
  const bHasError = b.error !== null;
  if (aHasError !== bHasError) {
    if (bHasError) diffs.error = { kind: 'added', b: b.error };
    else diffs.error = { kind: 'removed', a: a.error };
  } else if (
    aHasError &&
    bHasError &&
    JSON.stringify(a.error) !== JSON.stringify(b.error)
  ) {
    diffs.error = { kind: 'changed', a: a.error, b: b.error };
  }

  return diffs;
}

function sumDurations(spans: Span[]): number {
  return spans.reduce((total, s) => {
    if (!s.endedAt) return total;
    return (
      total + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime())
    );
  }, 0);
}

function listEarliest(
  summary: SpanSummary | undefined,
  all: Span[],
  name: string,
): number {
  if (!summary) {
    const fallback = all.find((s) => s.name === name);
    return fallback
      ? new Date(fallback.startedAt).getTime()
      : Number.MAX_SAFE_INTEGER;
  }
  const span = all.find((s) => s.id === summary.id);
  return span ? new Date(span.startedAt).getTime() : Number.MAX_SAFE_INTEGER;
}
