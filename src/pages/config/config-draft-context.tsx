import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { V2fSourceConfig, V2fEvidenceBlock, TransformConfigEntry } from "../../api/types";

interface ConfigDraftState {
  /** The source being edited (deep copy). Null when not editing. */
  draft: V2fSourceConfig | null;
  /** Whether anything has changed from the original. */
  dirty: boolean;
  /** Whether edit mode is active. */
  editing: boolean;
}

interface ConfigDraftActions {
  startEditing: (source: V2fSourceConfig) => void;
  cancelEditing: () => void;
  setTransforms: (transforms: TransformConfigEntry[]) => void;
  setEvidence: (evidence: V2fEvidenceBlock[]) => void;
  /** Merge a partial set of top-level fields (name, source_type, url, …) into
   *  the draft. Used by the schema-driven settings panel. */
  setFields: (fields: Partial<V2fSourceConfig>) => void;
  /** Get the current draft source (for saving). */
  getDraft: () => V2fSourceConfig | null;
}

type ConfigDraftContextValue = ConfigDraftState & ConfigDraftActions;

const ConfigDraftContext = createContext<ConfigDraftContextValue | null>(null);

export function ConfigDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<V2fSourceConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const editing = draft !== null;

  const startEditing = useCallback((source: V2fSourceConfig) => {
    setDraft(structuredClone(source));
    setDirty(false);
  }, []);

  const cancelEditing = useCallback(() => {
    setDraft(null);
    setDirty(false);
  }, []);

  const setTransforms = useCallback((transforms: TransformConfigEntry[]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, transformations: transforms };
    });
    setDirty(true);
  }, []);

  const setEvidence = useCallback((evidence: V2fEvidenceBlock[]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, evidence };
    });
    setDirty(true);
  }, []);

  const setFields = useCallback((fields: Partial<V2fSourceConfig>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...fields };
    });
    setDirty(true);
  }, []);

  const getDraft = useCallback(() => draft, [draft]);

  return (
    <ConfigDraftContext.Provider
      value={{ draft, dirty, editing, startEditing, cancelEditing, setTransforms, setEvidence, setFields, getDraft }}
    >
      {children}
    </ConfigDraftContext.Provider>
  );
}

export function useConfigDraft(): ConfigDraftContextValue {
  const ctx = useContext(ConfigDraftContext);
  if (!ctx) throw new Error("useConfigDraft must be used within ConfigDraftProvider");
  return ctx;
}
