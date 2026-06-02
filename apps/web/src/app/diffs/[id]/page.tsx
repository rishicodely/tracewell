import { notFound } from "next/navigation";
import Link from "next/link";
import { db, schema } from "@/lib/db";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Mirror the shape from diff-spans.ts on the API side.
interface DiffResult {
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

interface SpanDiff {
  name: string;
  kind: string;
  status: "matched" | "diverged" | "only_in_a" | "only_in_b";
  a?: SpanSummary;
  b?: SpanSummary;
  differences: Record<string, FieldDiff>;
}

interface SpanSummary {
  id: string;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  has_error: boolean;
}

type FieldDiff =
  | { kind: "delta"; a: number; b: number; delta_pct: number }
  | { kind: "changed"; a: unknown; b: unknown }
  | { kind: "added"; b: unknown }
  | { kind: "removed"; a: unknown };

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export default async function DiffPage({ params }: PageProps) {
  const { id } = await params;

  const [diff] = await db
    .select()
    .from(schema.diffs)
    .where(eq(schema.diffs.id, id))
    .limit(1);
  if (!diff) notFound();

  const [runA] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, diff.runAId))
    .limit(1);
  const [runB] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, diff.runBId))
    .limit(1);

  if (diff.status !== "completed") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-zinc-200 font-mono p-8">
        <h1 className="text-lg">diff status: {diff.status}</h1>
        {diff.error && (
          <p className="text-red-400 text-xs mt-2">{diff.error}</p>
        )}
      </main>
    );
  }

  const result = diff.result as DiffResult | null;
  if (!result) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-zinc-200 font-mono p-8">
        <h1 className="text-lg">diff has no result data</h1>
      </main>
    );
  }

  // Compute a shared time axis for both timelines: use the longer run as the scale.
  const totalDuration = Math.max(
    result.summary.total_duration_a_ms,
    result.summary.total_duration_b_ms,
    1,
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-200 font-mono">
      <header className="border-b border-zinc-900 px-8 py-6">
        <div className="flex items-baseline gap-4">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← runs
          </Link>
          <h1 className="text-lg tracking-tight">diff</h1>
          <span className="text-xs text-zinc-600">{id.slice(0, 8)}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <RunCard
            label="A"
            run={runA}
            totalMs={result.summary.total_duration_a_ms}
          />
          <RunCard
            label="B"
            run={runB}
            totalMs={result.summary.total_duration_b_ms}
          />
        </div>

        <SummaryStrip summary={result.summary} />
      </header>

      <div className="px-8 py-6">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-3">
          spans · {result.spans.length} total
        </div>
        <div className="space-y-1">
          {result.spans.map((span, i) => (
            <SpanDiffRow key={i} span={span} totalDuration={totalDuration} />
          ))}
        </div>
      </div>
    </main>
  );
}

function RunCard({
  label,
  run,
  totalMs,
}: {
  label: string;
  run: typeof schema.runs.$inferSelect | undefined;
  totalMs: number;
}) {
  if (!run) {
    return (
      <div className="border border-zinc-900 rounded p-3 text-zinc-600">
        run {label} not found
      </div>
    );
  }
  return (
    <Link
      href={`/runs/${run.id}`}
      className="block border border-zinc-900 rounded p-3 hover:border-zinc-800 hover:bg-zinc-900/40 transition-colors"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-zinc-500">run {label}</span>
        <span className="text-zinc-600 text-[10px]">{run.id.slice(0, 8)}</span>
      </div>
      <div className="text-zinc-200 mt-1">{run.name}</div>
      <div className="mt-2 flex gap-4 text-[10px] text-zinc-500">
        <span>{Math.round(totalMs)}ms</span>
        <span>{run.totalTokens.toLocaleString()} tokens</span>
        <span>
          {new Date(run.startedAt).toISOString().slice(0, 19).replace("T", " ")}
        </span>
      </div>
    </Link>
  );
}

function SummaryStrip({ summary }: { summary: DiffResult["summary"] }) {
  const deltaSign = summary.total_duration_delta_ms >= 0 ? "+" : "";
  const deltaColor =
    summary.total_duration_delta_ms === 0
      ? "text-zinc-500"
      : summary.total_duration_delta_ms > 0
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className="mt-4 flex flex-wrap gap-6 text-xs">
      <Stat
        label="matched"
        value={summary.matched_count}
        color="text-zinc-400"
      />
      <Stat
        label="diverged"
        value={summary.diverged_count}
        color="text-amber-400"
      />
      <Stat
        label="only in A"
        value={summary.only_in_a_count}
        color="text-sky-400"
      />
      <Stat
        label="only in B"
        value={summary.only_in_b_count}
        color="text-emerald-400"
      />
      <Stat
        label="duration Δ"
        value={`${deltaSign}${Math.round(summary.total_duration_delta_ms)}ms`}
        color={deltaColor}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={`mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function SpanDiffRow({
  span,
  totalDuration,
}: {
  span: SpanDiff;
  totalDuration: number;
}) {
  const statusColors: Record<
    SpanDiff["status"],
    { border: string; accent: string; label: string }
  > = {
    matched: {
      border: "border-zinc-900",
      accent: "bg-zinc-500",
      label: "text-zinc-500",
    },
    diverged: {
      border: "border-amber-900/60",
      accent: "bg-amber-500",
      label: "text-amber-400",
    },
    only_in_a: {
      border: "border-sky-900/60",
      accent: "bg-sky-500",
      label: "text-sky-400",
    },
    only_in_b: {
      border: "border-emerald-900/60",
      accent: "bg-emerald-500",
      label: "text-emerald-400",
    },
  };
  const c = statusColors[span.status];

  const aWidth = span.a ? (span.a.duration_ms / totalDuration) * 100 : 0;
  const bWidth = span.b ? (span.b.duration_ms / totalDuration) * 100 : 0;

  return (
    <details className={`group border ${c.border} rounded`}>
      <summary className="flex items-center gap-3 py-2 px-3 cursor-pointer hover:bg-zinc-900/40">
        <span className="text-zinc-500 group-open:text-zinc-300 text-xs">
          ▸
        </span>
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.accent}`} />
        <span className="text-zinc-200 text-xs flex-shrink-0 w-48 truncate">
          {span.name}
        </span>
        <span className="text-zinc-600 text-[10px] flex-shrink-0 w-24">
          {span.kind}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wider flex-shrink-0 w-20 ${c.label}`}
        >
          {span.status.replace("_", " ")}
        </span>

        <div className="flex-1 grid grid-cols-2 gap-3">
          <TimelineBar
            duration={span.a?.duration_ms ?? 0}
            widthPct={aWidth}
            accent={c.accent}
            present={!!span.a}
          />
          <TimelineBar
            duration={span.b?.duration_ms ?? 0}
            widthPct={bWidth}
            accent={c.accent}
            present={!!span.b}
          />
        </div>
      </summary>

      {Object.keys(span.differences).length > 0 && (
        <div className="ml-6 pl-6 border-l border-zinc-900 mr-3 mb-3 py-3 space-y-3 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            differences
          </div>
          {Object.entries(span.differences).map(([field, diff]) => (
            <FieldDiffBlock key={field} field={field} diff={diff} />
          ))}
        </div>
      )}
    </details>
  );
}

function TimelineBar({
  duration,
  widthPct,
  accent,
  present,
}: {
  duration: number;
  widthPct: number;
  accent: string;
  present: boolean;
}) {
  if (!present) {
    return (
      <div className="h-5 relative bg-zinc-950 border border-dashed border-zinc-900 rounded-sm flex items-center justify-center">
        <span className="text-[10px] text-zinc-700">—</span>
      </div>
    );
  }
  return (
    <div className="h-5 relative bg-zinc-900/40 rounded-sm">
      <div
        className={`absolute inset-y-0 left-0 ${accent} opacity-90 rounded-sm`}
        style={{ width: `${Math.max(widthPct, 0.5)}%`, minWidth: "2px" }}
      />
      <span className="absolute inset-y-0 right-2 flex items-center text-[10px] text-zinc-300">
        {duration}ms
      </span>
    </div>
  );
}

function FieldDiffBlock({ field, diff }: { field: string; diff: FieldDiff }) {
  if (diff.kind === "delta") {
    const sign = diff.delta_pct >= 0 ? "+" : "";
    const color =
      Math.abs(diff.delta_pct) > 20 ? "text-amber-400" : "text-zinc-400";
    return (
      <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
        <span className="text-zinc-500 text-[11px]">{field}</span>
        <div className="flex gap-3 items-baseline">
          <span className="text-zinc-300">{diff.a}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-300">{diff.b}</span>
          <span className={`text-[10px] ${color}`}>
            ({sign}
            {diff.delta_pct.toFixed(1)}%)
          </span>
        </div>
      </div>
    );
  }
  if (diff.kind === "changed") {
    return (
      <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
        <span className="text-zinc-500 text-[11px]">{field}</span>
        <div className="flex gap-3 items-baseline flex-wrap">
          <code className="text-zinc-300 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-900">
            {stringify(diff.a)}
          </code>
          <span className="text-zinc-600">→</span>
          <code className="text-zinc-300 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-900">
            {stringify(diff.b)}
          </code>
        </div>
      </div>
    );
  }
  if (diff.kind === "added") {
    return (
      <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
        <span className="text-zinc-500 text-[11px]">{field}</span>
        <div className="text-emerald-400">+ {stringify(diff.b)}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
      <span className="text-zinc-500 text-[11px]">{field}</span>
      <div className="text-red-400">− {stringify(diff.a)}</div>
    </div>
  );
}
