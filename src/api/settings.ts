import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import type { MutationResult } from "./types";

// Plain SQL upsert into _pegasus_meta — runs against the active DataSource.
export const updateMeta = async (
  key: string,
  value: string,
): Promise<MutationResult> => {
  await getDataSource().exec({
    sql:
      "INSERT INTO main._pegasus_meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    params: [key, value],
  });
  return { success: true };
};

export const useUpdateMeta = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      updateMeta(key, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["db"] });
    },
  });
};
