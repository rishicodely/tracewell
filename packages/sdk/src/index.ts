import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const currentSpanStorage = new AsyncLocalStorage<{ spanId: string }>();

export interface TracewellOptions {
  apiKey: string;
  baseUrl?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
}

export type SpanKind = "llm_call" | "tool_call" | "retry" | "state_update";

type Status = "running" | "succeeded" | "failed";

interface SpanPayload {
  id: string;
  parentSpanId?: string;
  kind: SpanKind;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationNs?: number; // <-- new
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export class Tracewell {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly queue = new Map<string, SpanPayload[]>(); // runId -> spans
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(opts: TracewellOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.maxBatchSize = opts.maxBatchSize ?? 20;
  }

  async startRun(input: {
    name: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Run> {
    const res = await this.request("POST", "/v1/runs", input);
    return new Run(this, res.id);
  }

  /** Internal: enqueue a span for batched flush. */
  enqueue(runId: string, span: SpanPayload): void {
    const list = this.queue.get(runId) ?? [];
    list.push(span);
    this.queue.set(runId, list);

    if (list.length >= this.maxBatchSize) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Force-flush all queued spans. Called automatically on run.end(). */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const entries = Array.from(this.queue.entries());
    this.queue.clear();

    await Promise.all(
      entries.map(async ([runId, spans]) => {
        if (spans.length === 0) return;
        try {
          await this.request("POST", `/v1/runs/${runId}/spans`, { spans });
        } catch (err) {
          // SDK design choice: log and drop, don't throw into the agent.
          // Observability should never crash the thing being observed.
          // eslint-disable-next-line no-console
          console.error("[tracewell] failed to flush spans:", err);
        }
      }),
    );
  }

  /** Internal: update a run (status, totals, ended_at). */
  async patchRun(
    runId: string,
    patch: Partial<{
      status: Status;
      totalTokens: number;
      totalCostUsd: number;
    }>,
  ): Promise<void> {
    await this.request("PATCH", `/v1/runs/${runId}`, patch);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    }
    return res.json();
  }
}

export class Run {
  constructor(
    private readonly client: Tracewell,
    public readonly id: string,
  ) {}

  /**
   * Wrap a unit of work in a span. The span is auto-timed and queued
   * for batched upload. Returns whatever the inner function returns.
   */
  async span<T>(
    kind: SpanKind,
    name: string,
    fn: (span: SpanHandle) => Promise<T> | T,
    opts?: { parentSpanId?: string },
  ): Promise<T> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const startedHr = process.hrtime.bigint(); // <-- new (see P2)
    const handle = new SpanHandle();

    // Resolve parent: explicit override > ambient context > none
    const ambientParent = currentSpanStorage.getStore()?.spanId;
    const parentSpanId = opts?.parentSpanId ?? ambientParent;

    // Run the callback with this span as the new ambient parent.
    return currentSpanStorage.run({ spanId: id }, async () => {
      try {
        const result = await fn(handle);
        const endedHr = process.hrtime.bigint();
        this.client.enqueue(this.id, {
          id,
          parentSpanId,
          kind,
          name,
          startedAt,
          endedAt: new Date().toISOString(),
          durationNs: Number(endedHr - startedHr), // <-- new (see P2)
          input: handle.input,
          output: handle.output,
          tokensIn: handle.tokensIn,
          tokensOut: handle.tokensOut,
          costUsd: handle.costUsd,
        });
        return result;
      } catch (err) {
        const endedHr = process.hrtime.bigint();
        this.client.enqueue(this.id, {
          id,
          parentSpanId,
          kind,
          name,
          startedAt,
          endedAt: new Date().toISOString(),
          durationNs: Number(endedHr - startedHr),
          input: handle.input,
          error: {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
        });
        throw err;
      }
    });
  }

  async end(opts: {
    status: Status;
    totalTokens?: number;
    totalCostUsd?: number;
  }): Promise<void> {
    await this.client.flush();
    await this.client.patchRun(this.id, opts);
  }
}

/** Mutable handle passed into the span body so the caller can set fields. */
export class SpanHandle {
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;

  setInput(input: Record<string, unknown>): this {
    this.input = input;
    return this;
  }
  setOutput(output: Record<string, unknown>): this {
    this.output = output;
    return this;
  }
  setTokens(tokensIn: number, tokensOut: number): this {
    this.tokensIn = tokensIn;
    this.tokensOut = tokensOut;
    return this;
  }
  setCost(costUsd: number): this {
    this.costUsd = costUsd;
    return this;
  }
}
