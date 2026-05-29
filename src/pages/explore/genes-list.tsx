import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  listImplicatedGenes,
  type GeneRow,
} from "../../data/queries/explore";
import { DataTable, type Column } from "./data-table";

export function GenesList() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["explore", "genes"],
    queryFn: listImplicatedGenes,
  });
  const rows = q.data ?? [];

  const columns: Column<GeneRow>[] = [
    { key: "gene_symbol", header: "Gene", value: (r) => r.gene_symbol, mono: true },
    { key: "chromosome", header: "Chr", value: (r) => r.chromosome, mono: true },
    {
      key: "start",
      header: "Position",
      value: (r) => (r.start != null ? r.start.toLocaleString() : ""),
      sortValue: (r) => r.start,
      align: "right",
      mono: true,
    },
    { key: "gene_type", header: "Biotype", value: (r) => r.gene_type, mono: true },
    { key: "n_loci", header: "Loci", value: (r) => r.n_loci, align: "right", mono: true },
    {
      key: "n_evidence",
      header: "Evidence",
      value: (r) => r.n_evidence,
      align: "right",
      mono: true,
    },
    {
      key: "n_categories",
      header: "Categories",
      value: (r) => r.n_categories,
      align: "right",
      mono: true,
    },
  ];

  if (q.isLoading) return <p className="text-sm text-base-content/40">Loading…</p>;
  return (
    <DataTable
      rows={rows}
      columns={columns}
      filterKeys={["gene_symbol", "chromosome", "gene_type"]}
      filterPlaceholder="Filter genes…"
      initialSort={{ key: "n_loci", dir: "desc" }}
      onRowClick={(r) =>
        navigate(`/explore/gene/${encodeURIComponent(r.gene_symbol)}`)
      }
      emptyMessage="No implicated genes yet — rebuild derived data."
    />
  );
}
