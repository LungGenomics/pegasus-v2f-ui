import type { DataSource } from "../types";

export type Migration = {
  version: number;
  name: string;
  apply: (ds: DataSource) => Promise<void>;
};
