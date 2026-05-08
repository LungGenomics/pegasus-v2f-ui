export type DataSourceCapabilities = {
  canWrite: boolean;
  canRunPipeline: boolean;
  persistence: "file" | "opfs" | "memory" | "none";
  label: string;
};

export type Row = Record<string, unknown>;

export type SqlQuery = {
  sql: string;
  params?: unknown[];
};

export interface DataSource {
  capabilities: DataSourceCapabilities;
  query<T = Row>(q: SqlQuery): Promise<T[]>;
  exec(q: SqlQuery): Promise<void>;
  flush?(): Promise<void>;
}
