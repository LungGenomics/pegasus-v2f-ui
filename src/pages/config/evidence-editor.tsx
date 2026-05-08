// Evidence-blocks editor for one source. The whole array is now driven by
// the `list-of-objects` field type — add / remove / per-item rendering all
// live in SchemaFields against `evidenceListSchema`.

import type { V2fEvidenceBlock } from "../../api/types";
import { SchemaFields } from "../../components/schema-form/schema-form";
import { SchemaFormProvider } from "../../components/schema-form/context";
import { evidenceBlockSchema } from "../../data/config-schema/evidence-block";
import type {
  EntitySchema,
  FormState,
} from "../../components/schema-form/types";

interface Props {
  evidence: V2fEvidenceBlock[];
  availableColumns: string[];
  onChange: (evidence: V2fEvidenceBlock[]) => void;
}

const evidenceListSchema: EntitySchema = {
  evidence: {
    type: "list-of-objects",
    label: "",
    itemSchema: evidenceBlockSchema,
    itemLabel: "Evidence block",
    defaultItem: {
      source_tag: "",
      category: "OTHER",
      centric: "gene",
      fields: {},
    },
    summarize: (item) => {
      const tag = (item.source_tag as string) ?? "";
      const cat = (item.category as string) ?? "";
      return [tag, cat].filter(Boolean).join(" · ");
    },
  },
};

export function EvidenceEditor({ evidence, availableColumns, onChange }: Props) {
  const value: FormState = { evidence: evidence as unknown as FormState[] };
  return (
    <SchemaFormProvider columns={availableColumns}>
      <SchemaFields
        schema={evidenceListSchema}
        value={value}
        onChange={(next) => {
          const items = (next.evidence as FormState[] | undefined) ?? [];
          onChange(items as unknown as V2fEvidenceBlock[]);
        }}
      />
    </SchemaFormProvider>
  );
}
