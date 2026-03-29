// ─── Enums ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "bootstrapping"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type SourceType = "postgres" | "mysql" | "duckdb" | "s3_parquet" | "trino";

export type EntityType = "primary" | "foreign";
export type DimensionType = "categorical" | "time";
export type MeasureAgg = "count" | "sum" | "avg" | "min" | "max" | "count_distinct";
export type RelationshipSource = "explicit" | "inferred";
export type LlmProvider = "openai" | "anthropic" | "ollama" | "groq" | "featherless";
export type TableType = "fact" | "dimension" | "bridge" | "unknown";
export type ConstraintType = "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  model: string | null;
  api_key_set: boolean;
}

export interface AppSettings {
  active_provider: LlmProvider | null;
  providers: Record<LlmProvider, ProviderConfig>;
}

export interface SaveProviderRequest {
  provider: LlmProvider;
  model: string;
  api_key?: string;
}

export interface ActivateProviderRequest {
  provider: LlmProvider;
}

export interface TestLlmResult {
  ok: boolean;
  model: string | null;
  latency_ms: number | null;
  error: string | null;
}

export interface EmbeddingSettings {
  api_key_set: boolean;
  model: string;
}

export interface SaveEmbeddingRequest {
  api_key: string;
}

export interface BusinessContextFields {
  company_description: string;
  business_model: string;
  fiscal_year_start: string;
  currency: string;
  revenue_definition: string;
  churn_definition: string;
  exclusions: string;
  additional_context: string;
}

export type BusinessContextResponse = BusinessContextFields;
export type SaveBusinessContextRequest = BusinessContextFields;

// ─── Connectors ───────────────────────────────────────────────────────────────

export interface ConnectorInfo {
  type: SourceType;
  label: string;
  required_fields: string[];
  optional_fields?: string[];
}

// ─── Source Config ────────────────────────────────────────────────────────────

export interface SourceConfig {
  source_type: SourceType;
  // postgres / mysql / trino
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  // duckdb
  file_path?: string;
  // s3_parquet
  s3_bucket?: string;
  s3_prefix?: string;
  s3_region?: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  // optional filters
  include_schemas?: string[];
  exclude_schemas?: string[];
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export interface StartJobRequest {
  source_config: SourceConfig;
}

export interface JobResponse {
  id: string;
  status: JobStatus;
  source_type: string;
  tables_total: number;
  tables_processed: number;
  progress_pct: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  source_config_safe: Record<string, unknown> | null;
}

// ─── SSE Events ───────────────────────────────────────────────────────────────

export interface ProgressEvent {
  job_id: string;
  phase: string;
  message: string;
  table_name: string | null;
  progress_pct: number;
  timestamp: string;
}

export interface ChatToken {
  token: string;
}

// ─── Schema Catalog ───────────────────────────────────────────────────────────

export interface ConstraintMeta {
  constraint_type: ConstraintType;
  column_names: string[];
  fk_table: string | null;
  fk_column_names: string[];
}

export interface ColumnMeta {
  column_name: string;
  column_type: string;
  is_nullable: boolean;
  column_default: string | null;
  ordinal_position: number;
  is_primary_key: boolean;
  foreign_key_ref: string | null;
}

export interface TableMeta {
  database_name: string;
  schema_name: string;
  table_name: string;
  column_count: number;
  row_estimate: number;
  columns: ColumnMeta[];
  constraints: ConstraintMeta[];
}

// ─── Data Profiles ────────────────────────────────────────────────────────────

export interface ColumnProfile {
  column_name: string;
  column_type: string;
  row_count: number;
  null_count: number;
  null_percentage: number;
  approx_unique: number;
  min_val: string | null;
  max_val: string | null;
  avg: number | null;
  std: number | null;
  q25: number | null;
  q50: number | null;
  q75: number | null;
  sample_values: string[];
}

export interface ProfileResult {
  database_name: string;
  schema_name: string;
  table_name: string;
  row_count: number;
  column_profiles: ColumnProfile[];
  sample_rows: Record<string, unknown>[];
}

// ─── Relationships ────────────────────────────────────────────────────────────

export interface Relationship {
  from_database: string;
  from_schema: string;
  from_table: string;
  from_column: string;
  to_database: string;
  to_schema: string;
  to_table: string;
  to_column: string;
  confidence: number;
  source: RelationshipSource;
}

// ─── Semantic Layer ───────────────────────────────────────────────────────────

export interface Entity {
  name: string;
  entity_type: EntityType;
  column_name: string;
  description: string;
}

export interface Dimension {
  name: string;
  dim_type: DimensionType;
  column_name: string;
  description: string;
  time_granularity: string | null;
}

export interface Measure {
  name: string;
  agg: MeasureAgg;
  expr: string;
  description: string;
}

export interface SemanticModel {
  database_name: string;
  schema_name: string;
  table_name: string;
  description: string;
  table_type: TableType;
  grain: string;
  entities: Entity[];
  dimensions: Dimension[];
  measures: Measure[];
}

// ─── Charts & Dashboards ──────────────────────────────────────────────────────

export type ChartType = "bar" | "line" | "area" | "pie" | "donut" | "kpi" | "table" | "scatter" | "combo" | "funnel" | "heatmap";

export interface ChartConfig {
  x_column?: string | null;
  y_columns?: string[];
  series_column?: string | null;
  value_column?: string | null;
  label_column?: string | null;
  bar_layout?: "vertical" | "horizontal";
  stack?: boolean;
  show_legend?: boolean;
  show_grid?: boolean;
}

export interface Dataset {
  id: string;
  job_id: string;
  name: string;
  description: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export interface Chart {
  id: string;
  dataset_id: string;
  name: string;
  description: string;
  chart_type: ChartType;
  config: ChartConfig;
  created_at: string;
  updated_at: string;
}

export interface ChartSnapshot {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  cached_at: string | null;
  error: string | null;
}

export interface DashboardChart {
  id: string;
  chart_id: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  chart_name: string;
  chart_type: ChartType;
  dataset_id: string;
  config: ChartConfig;
  snapshot: ChartSnapshot | null;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardDetail extends Dashboard {
  charts: DashboardChart[];
}

export interface DatasetDataResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
  error: string | null;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatRequest {
  job_id: string;
  message: string;
}

export interface ToolResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
  text?: string | null;   // non-SQL tool results (list_databases, describe_table, etc.)
  error?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "thinking" | "status";
  content: string;
  timestamp: Date;
  // role="tool" only:
  toolName?: string;
  toolInput?: string;   // the SQL
  toolResult?: ToolResult | null;
  isLoading?: boolean;
  // role="status" only:
  statusText?: string;
}
