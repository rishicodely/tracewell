import Link from "next/link";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const rows = await db.execute<{
    id: string;
    name: string;
    status: string;
    started_at: Date;
    ended_at: Date | null;
    duration_ms: number | null;
    span_count: number;
    total_tokens: number;
  }>(sql`
    SELECT
      r.id, r.name, r.status, r.started_at, r.ended_at,
      EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000 AS duration_ms,
      COUNT(s.id)::int AS span_count,
      r.total_tokens
    FROM runs r
    LEFT JOIN spans s ON s.run_id = r.id
    GROUP BY r.id
    ORDER BY r.started_at DESC
    LIMIT 50
  `);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-200 font-mono">
      <header className="border-b border-zinc-900 px-8 py-6">
        <div className="flex items-baseline gap-4">
          <h1 className="text-lg tracking-tight">tracewell</h1>
          <span className="text-xs text-zinc-600">
            agent traces · {rows.rows.length} runs
          </span>
        </div>
      </header>

      <div className="px-8 py-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-900">
              <th className="py-2 pr-4 font-normal">status</th>
              <th className="py-2 pr-4 font-normal">name</th>
              <th className="py-2 pr-4 font-normal">started</th>
              <th className="py-2 pr-4 font-normal text-right">spans</th>
              <th className="py-2 pr-4 font-normal text-right">tokens</th>
              <th className="py-2 pr-4 font-normal text-right">duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-zinc-900/50 hover:bg-zinc-900/40 transition-colors"
              >
                <td className="py-3 pr-4">
                  <StatusDot status={r.status} />
                </td>
                <td className="py-3 pr-4">
                  <Link
                    href={`/runs/${r.id}`}
                    className="text-zinc-100 hover:text-emerald-400"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-zinc-500 text-xs">
                  {new Date(r.started_at)
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19)}
                </td>
                <td className="py-3 pr-4 text-right text-zinc-400">
                  {r.span_count}
                </td>
                <td className="py-3 pr-4 text-right text-zinc-400">
                  {r.total_tokens?.toLocaleString() ?? "—"}
                </td>
                <td className="py-3 pr-4 text-right text-zinc-400">
                  {r.duration_ms ? `${Math.round(r.duration_ms)}ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "succeeded"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-amber-500 animate-pulse";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-zinc-400">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {status}
    </span>
  );
}
