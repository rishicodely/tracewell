import { notFound } from "next/navigation";
import Link from "next/link";
import { db, schema } from "@/lib/db";
import { eq, asc } from "drizzle-orm";

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RunPage({ params }: PageProps) {
  const { id } = await params;

  const [run] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, id))
    .limit(1);
  if (!run) notFound();

  const spans = await db
    .select()
    .from(schema.spans)
    .where(eq(schema.spans.runId, id))
    .orderBy(asc(schema.spans.startedAt));

  // Compute timeline window
  const runStart = new Date(run.startedAt).getTime();
  const runEnd = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  const totalDuration = Math.max(runEnd - runStart, 1); // avoid div-by-zero

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-200 font-mono">
      <header className="border-b border-zinc-900 px-8 py-6">
        <div className="flex items-baseline gap-4">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← runs
          </Link>
          <h1 className="text-lg tracking-tight">{run.name}</h1>
          <StatusBadge status={run.status} />
        </div>
        <div className="mt-3 flex gap-6 text-xs text-zinc-500">
          <span>
            id: <span className="text-zinc-400">{run.id.slice(0, 8)}</span>
          </span>
          <span>
            model: <span className="text-zinc-400">{run.model ?? "—"}</span>
          </span>
          <span>
            duration:{" "}
            <span className="text-zinc-400">{Math.round(totalDuration)}ms</span>
          </span>
          <span>
            spans: <span className="text-zinc-400">{spans.length}</span>
          </span>
          <span>
            tokens:{" "}
            <span className="text-zinc-400">
              {run.totalTokens.toLocaleString()}
            </span>
          </span>
        </div>
        {(() => {
          const meta = run.metadata as Record<string, unknown> | null;
          if (!meta || Object.keys(meta).length === 0) return null;
          return (
            <div className="mt-3 text-xs text-zinc-500">
              metadata: <span className="text-zinc-400">{stringify(meta)}</span>
            </div>
          );
        })()}
      </header>

      <div className="px-8 py-6">
        <div className="space-y-1">
          {/* Time axis */}
          <div className="relative h-6 mb-2 text-[10px] text-zinc-600">
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
              <span
                key={pct}
                className="absolute"
                style={{
                  left: `calc(${pct * 100}% + ${pct === 0 ? 256 : pct === 1 ? -40 : -20}px)`,
                }}
              >
                {Math.round(totalDuration * pct)}ms
              </span>
            ))}
          </div>

          {spans.map((span) => {
            const spanStart = new Date(span.startedAt).getTime();
            const spanEnd = span.endedAt
              ? new Date(span.endedAt).getTime()
              : spanStart;
            const offsetPct = ((spanStart - runStart) / totalDuration) * 100;
            const widthPct = Math.max(
              ((spanEnd - spanStart) / totalDuration) * 100,
              0.5,
            );
            const durationMs =
              span.durationNs !== null
                ? span.durationNs / 1_000_000
                : spanEnd - spanStart;
            return (
              <SpanRow
                key={span.id}
                span={span}
                offsetPct={offsetPct}
                widthPct={widthPct}
                durationMs={durationMs}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "succeeded"
      ? "bg-emerald-950 text-emerald-400 border-emerald-900"
      : status === "failed"
        ? "bg-red-950 text-red-400 border-red-900"
        : "bg-amber-950 text-amber-400 border-amber-900";
  return (
    <span className={`text-xs px-2 py-0.5 border rounded ${styles}`}>
      {status}
    </span>
  );
}

function SpanRow({
  span,
  offsetPct,
  widthPct,
  durationMs,
}: {
  span: typeof schema.spans.$inferSelect;
  offsetPct: number;
  widthPct: number;
  durationMs: number;
}) {
  const kindColor: Record<string, string> = {
    llm_call: "bg-emerald-500",
    tool_call: "bg-sky-500",
    retry: "bg-amber-500",
    state_update: "bg-zinc-500",
  };
  const barColor = kindColor[span.kind] ?? "bg-zinc-500";

  return (
    <details className="group">
      <summary className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-zinc-900/40 -mx-2 px-2 rounded">
        {/* Left column: name + kind */}
        <div className="w-64 flex-shrink-0 flex items-center gap-2 text-xs">
          <span className="text-zinc-500 group-open:text-zinc-300">▸</span>
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${barColor}`}
          />
          <span className="text-zinc-200 truncate">{span.name}</span>
          <span className="text-zinc-600 text-[10px]">{span.kind}</span>
        </div>

        {/* Timeline track */}
        <div className="flex-1 relative h-5">
          <div className="absolute inset-y-0 left-0 right-0 bg-zinc-900/40 rounded-sm" />
          <div
            className={`absolute inset-y-0 ${barColor} opacity-90 rounded-sm`}
            style={{
              left: `${offsetPct}%`,
              width: `${widthPct}%`,
              minWidth: "2px",
            }}
          />
          <span
            className="absolute inset-y-0 flex items-center text-[10px] text-zinc-300 px-1.5"
            style={{ left: `${Math.min(offsetPct + widthPct, 92)}%` }}
          >
            {durationMs < 1
              ? `${(durationMs * 1000).toFixed(0)}μs`
              : durationMs < 10
                ? `${durationMs.toFixed(2)}ms`
                : `${Math.round(durationMs)}ms`}{" "}
          </span>
        </div>

        {/* Right column: token count if present */}
        <div className="w-24 flex-shrink-0 text-right text-[10px] text-zinc-500">
          {span.tokensIn !== null && span.tokensOut !== null
            ? `${span.tokensIn} → ${span.tokensOut}`
            : ""}
        </div>
      </summary>

      <div className="ml-6 pl-6 border-l border-zinc-900 py-3 space-y-3 text-xs">
        {span.input != null && <DetailBlock label="input" data={span.input} />}

        {span.output != null && (
          <DetailBlock label="output" data={span.output} />
        )}

        {span.error != null && (
          <DetailBlock label="error" data={span.error} variant="error" />
        )}
      </div>
    </details>
  );
}

function DetailBlock({
  label,
  data,
  variant,
}: {
  label: string;
  data: unknown;
  variant?: "error";
}) {
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-wider mb-1 ${variant === "error" ? "text-red-500" : "text-zinc-500"}`}
      >
        {label}
      </div>
      <pre
        className={`text-[11px] leading-relaxed p-3 rounded border overflow-x-auto ${
          variant === "error"
            ? "bg-red-950/30 border-red-900/50 text-red-200"
            : "bg-zinc-950 border-zinc-900 text-zinc-300"
        }`}
      >
        {JSON.stringify(data, null, 2) ?? "null"}
      </pre>
    </div>
  );
}
