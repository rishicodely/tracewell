import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { bigint } from 'drizzle-orm/pg-core';

// Note: we don't define the vector column in Drizzle yet — we'll use raw SQL
// for embedding queries later. Keeping schema.ts focused on the relational parts.

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    status: text('status').notNull(),
    model: text('model'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    projectStartedIdx: index('idx_runs_project_started').on(
      t.projectId,
      t.startedAt.desc(),
    ),
  }),
);

export const spans = pgTable(
  'spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    parentSpanId: uuid('parent_span_id'),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    input: jsonb('input'),
    output: jsonb('output'),
    error: jsonb('error'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    durationNs: bigint('duration_ns', { mode: 'number' }),
  },
  (t) => ({
    runIdx: index('idx_spans_run').on(t.runId, t.startedAt),
    parentIdx: index('idx_spans_parent').on(t.parentSpanId),
  }),
);

export const diffs = pgTable(
  'diffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    runAId: uuid('run_a_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    runBId: uuid('run_b_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    projectCreatedIdx: index('idx_diffs_project_created').on(
      t.projectId,
      t.createdAt.desc(),
    ),
    runsIdx: index('idx_diffs_runs').on(t.runAId, t.runBId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Span = typeof spans.$inferSelect;
export type NewSpan = typeof spans.$inferInsert;
export type Diff = typeof diffs.$inferSelect;
export type NewDiff = typeof diffs.$inferInsert;
