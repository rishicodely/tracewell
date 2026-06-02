CREATE TABLE diffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  run_a_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  run_b_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','computing','completed','failed')),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_diffs_project_created ON diffs(project_id, created_at DESC);
CREATE INDEX idx_diffs_runs ON diffs(run_a_id, run_b_id);