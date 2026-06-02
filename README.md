# Tracewell

Self-hostable observability for LLM agents. Drop in an SDK, see every tool call, retry, token cost, and state transition on a timeline. Diff two runs to find why one succeeded and one failed.

```
                  ┌──────────┐
   your agent ──▶ │ Tracewell├──▶ Postgres ──▶ Timeline UI
                  │   SDK    │                 Diff UI
                  └──────────┘
```

Built on NestJS, Postgres, BullMQ, and Next.js. Single `docker compose up` to run the whole stack locally.

---

## Why

Agent runs are hard to debug. You stare at console logs trying to figure out why the model took a wrong turn on step 7, or why a tool call hung for 4 seconds, or why one user's request cost 8000 tokens and another cost 800.

Existing tools (LangSmith, Langfuse, Helicone) are great but SaaS-first. Tracewell is opinionated, self-hostable, and built for engineers who already run their own infra and want their trace data to live next to their application data.

---

## Quickstart

```bash
# 1. Run the stack
git clone https://github.com/rishicodely/tracewell.git
cd tracewell
docker compose up -d
pnpm install
pnpm --filter @tracewell/api start:dev   # API on :3000
pnpm --filter web dev                     # UI on :3001

# 2. Create a project, get an API key
curl -X POST http://localhost:3000/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent"}'
# response includes api_key: tw_...

# 3. Instrument your agent
npm install @tracewell/sdk
```

```typescript
import { Tracewell } from "@tracewell/sdk";

const tw = new Tracewell({ apiKey: process.env.TRACEWELL_API_KEY });

const run = await tw.startRun({ name: "analyze-document" });

await run.span("tool_call", "scrape", async (s) => {
  s.setInput({ url });
  const text = await scrape(url);
  s.setOutput({ length: text.length });
  return text;
});

await run.span("llm_call", "classify", async (s) => {
  s.setInput({ prompt });
  const res = await llm.complete({ prompt });
  s.setOutput({ result: res.text });
  s.setTokens(res.usage.input, res.usage.output);
  return res;
});

await run.end({ status: "succeeded" });
```

Open `http://localhost:3001`, see the run.

---

## What you get

**Timeline view.** Every span as a horizontal bar positioned by start time, colored by kind (LLM call, tool call, retry, state update). Click to expand and see the full input, output, and error payloads. Sub-millisecond spans render in microseconds.

**Diff view.** Pass two run IDs, get a structured comparison: which spans matched, which diverged, which appeared in only one run. Duration deltas, token deltas, error appearances. Computed async via BullMQ.

**SDK that doesn't crash your agent.** Span uploads are batched (every 500ms or 20 spans, whichever first). Network failures are logged and dropped, never thrown — observability shouldn't crash the thing it observes. Span IDs are assigned client-side so you can reference `parentSpanId` without a round-trip.

**Auto-nesting via AsyncLocalStorage.** Spans created inside other spans' callbacks automatically inherit `parentSpanId`. Same pattern OpenTelemetry uses; the API stays flat.

---

## Architecture

| Layer           | Choice              | Why                                                                                                                           |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ingest API      | NestJS              | Burst writes from agent runs need proper validation, DI, and backpressure handling                                            |
| Storage         | Postgres with JSONB | Spans are relational (parent/child), payloads are arbitrary blobs. JSONB for the blobs, normalized columns for what you query |
| Background work | BullMQ on Redis     | Diff jobs and trace analysis are slow. Queued, not synchronous                                                                |
| Vector search   | pgvector            | Semantic search over traces ("find runs where the agent got confused about auth") is a vector query, not a SQL query          |
| UI              | Next.js App Router  | Server-rendered timeline. The expand/collapse uses native `<details>`. No client JS unless interaction needs it               |

The SDK is ~250 lines of TypeScript with zero runtime dependencies beyond Node's built-ins.

---

## Design decisions worth flagging

**SDK assigns span IDs, not the server.** Lets you reference parent spans before they've been uploaded. Same approach as OpenTelemetry, Sentry. The alternative (server-assigned IDs) requires a synchronous create-before-reference pattern that defeats batching.

**Idempotent ingest via `onConflictDoNothing`.** If the SDK retries a failed batch, you don't want duplicate spans. The DB enforces it.

**Diff significance threshold at 10%.** Duration changes under 10% don't count as "diverged" — every run varies slightly, and surfacing 1.2% deltas turns the diff view into noise. Tunable; the constant is named.

**Sub-millisecond timing via `process.hrtime.bigint()`.** `Date.toISOString()` is millisecond precision, which is fine for network calls but lies about fast local work. The SDK captures `durationNs` separately so a 380μs prompt-build doesn't show as 0ms.

**Schema in raw SQL, types in Drizzle.** Migrations live in `apps/api/drizzle/*.sql`. The Drizzle schema is the queryable TypeScript surface; pgvector columns and partial indexes don't go through the ORM because the ORM support is thin and forcing them through costs more than it gives.

---

## API

All endpoints under `/v1/`. Authentication via `x-api-key` header except where noted.

| Method  | Path                 | Notes                                            |
| ------- | -------------------- | ------------------------------------------------ |
| `POST`  | `/v1/projects`       | Create a project. No auth. Returns api_key once. |
| `POST`  | `/v1/runs`           | Start a run                                      |
| `PATCH` | `/v1/runs/:id`       | Update status, totals, ended_at                  |
| `POST`  | `/v1/runs/:id/spans` | Append spans (batched array)                     |
| `POST`  | `/v1/diffs`          | Queue a diff between two runs                    |
| `GET`   | `/v1/diffs/:id`      | Poll for diff result                             |

See `apps/api/requests.http` for a runnable scratch file.

---

## Status

Active, building in public on X. Current version is v0.2.

**v0.2 (latest):** AsyncLocalStorage for span context, `process.hrtime` for sub-ms span timing.
**v0.1:** Ingest API, SDK, timeline UI, diff feature.

**Near-term roadmap:**

- Deploy template (Railway / Fly + Vercel)
- Semantic search over traces via pgvector
- Streaming span events for real-time monitoring
- Voice agent example (turn-taking, STT → LLM → TTS latency)
- Python SDK

---

## Examples

Tracewell has been dogfooded on:

- **[Ghost](https://github.com/rishicodely/ghost-tos-auditor)** — a Terms-of-Service auditor that scrapes a URL, extracts risky clauses via LLM, and scores privacy risk. Five-span traces per request; useful for demonstrating sequential pipeline observability.

More example integrations coming as the project matures.

---

## Contributing

Issues and PRs welcome. The codebase is small and the design is opinionated — open an issue before sending a large PR so we can discuss direction.

For local dev:

- `pnpm install` at the repo root
- `docker compose up -d` for Postgres + Redis
- `pnpm --filter @tracewell/api start:dev` for the API
- `pnpm --filter web dev` for the UI
- Migrations are in `apps/api/drizzle/*.sql`, applied via `psql`

---

## License

MIT.

---

Built by [Rishika Reddy](https://github.com/rishicodely). Follow [@gitkittie](https://x.com/gitkittie) for build-in-public updates.
