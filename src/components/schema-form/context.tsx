// React context that lets schema-form fields opt into typed inputs that
// reference data outside the form — most importantly column-ref fields,
// which render as selects populated from the upstream stage's preview
// columns when wrapped in <SchemaFormProvider columns={...}>.

import { createContext, useContext, type ReactNode } from "react";

export type SchemaFormContextValue = {
  availableColumns: string[];
};

const Ctx = createContext<SchemaFormContextValue>({ availableColumns: [] });

export function SchemaFormProvider({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ availableColumns: columns }}>{children}</Ctx.Provider>;
}

export function useSchemaFormContext(): SchemaFormContextValue {
  return useContext(Ctx);
}
