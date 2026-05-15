import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  },
  (t) => ({
    runIdx: index('idx_spans_run').on(t.runId, t.startedAt),
    parentIdx: index('idx_spans_parent').on(t.parentSpanId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Span = typeof spans.$inferSelect;
export type NewSpan = typeof spans.$inferInsert;
