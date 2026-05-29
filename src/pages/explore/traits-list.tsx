import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { listTraits, type TraitRow } from "../../data/queries/explore";
import { DataTable, type Column } from "./data-table";

export function TraitsList() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["explore", "traits"], queryFn: listTraits });
  const rows = q.data ?? [];

  const columns: Column<TraitRow>[] = [
    { key: "label", header: "Trait", value: (r) => r.label },
    { key: "n_loci", header: "Loci", value: (r) => r.n_loci, align: "right", mono: true },
    { key: "n_genes", header: "Genes", value: (r) => r.n_genes, align: "right", mono: true },
    {
      key: "n_evidence",
      header: "Evidence",
      value: (r) => r.n_evidence,
      align: "right",
      mono: true,
    },
  ];

  if (q.isLoading) return <p className="text-sm text-base-content/40">Loading…</p>;
  return (
    <DataTable
      rows={rows}
      columns={columns}
      filterKeys={["label"]}
      filterPlaceholder="Filter traits…"
      initialSort={{ key: "n_loci", dir: "desc" }}
      onRowClick={(r) =>
        navigate(`/explore/trait/${encodeURIComponent(r.trait_id)}`)
      }
      emptyMessage="No traits yet."
    />
  );
}
