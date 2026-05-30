import { Tracewell } from "./index";

async function main() {
  const tw = new Tracewell({
    apiKey: process.env.TRACEWELL_API_KEY!,
  });

  const run = await tw.startRun({
    name: "sdk-smoke-test",
    model: "claude-sonnet-4",
    metadata: { source: "sdk-test" },
  });

  await run.span("llm_call", "classify_intent", async (s) => {
    s.setInput({ messages: [{ role: "user", content: "billing issue" }] });
    await new Promise((r) => setTimeout(r, 100));
    s.setOutput({ intent: "billing" });
    s.setTokens(120, 8);
    s.setCost(0.0012);
  });

  await run.span("tool_call", "lookup_invoice", async (s) => {
    s.setInput({ user_id: "U-42" });
    await new Promise((r) => setTimeout(r, 50));
    s.setOutput({ invoice_id: "INV-7" });
  });

  await run.end({
    status: "succeeded",
    totalTokens: 128,
    totalCostUsd: 0.0012,
  });
  console.log("done, runId:", run.id);
}

main().catch(console.error);
