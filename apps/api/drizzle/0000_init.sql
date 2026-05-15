CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  model TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  total_tokens INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536)
);

CREATE INDEX idx_runs_project_started ON runs(project_id, started_at DESC);
CREATE INDEX idx_runs_status ON runs(status) WHERE status = 'running';

CREATE TABLE spans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  parent_span_id UUID REFERENCES spans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('llm_call','tool_call','retry','state_update')),
  name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  input JSONB,
  output JSONB,
  error JSONB,
  tokens_in INT,
  tokens_out INT,
  cost_usd NUMERIC(12,6)
);

CREATE INDEX idx_spans_run ON spans(run_id, started_at);
CREATE INDEX idx_spans_parent ON spans(parent_span_id);