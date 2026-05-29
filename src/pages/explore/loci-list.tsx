import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { listLoci, type LocusRow } from "../../data/queries/explore";
import { DataTable, type Column } from "./data-table";

function fmtP(p: number | null): string {
  if (p === null || p === undefined) return "";
  return p < 1e-3 ? p.toExponential(1) : String(p);
}

export function LociList() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["explore", "loci"], queryFn: listLoci });
  const rows = q.data ?? [];

  const columns: Column<LocusRow>[] = [
    { key: "locus_name", header: "Locus", value: (r) => r.locus_name, mono: true },
    { key: "chromosome", header: "Chr", value: (r) => r.chromosome, mono: true },
    {
      key: "n_signals",
      header: "Signals",
      value: (r) => r.n_signals,
      align: "right",
      mono: true,
    },
    {
      key: "n_candidate_genes",
      header: "Genes",
      value: (r) => r.n_candidate_genes,
      align: "right",
      mono: true,
    },
    { key: "lead_rsid", header: "Lead", value: (r) => r.lead_rsid, mono: true },
    {
      key: "lead_pvalue",
      header: "Lead p",
      value: (r) => fmtP(r.lead_pvalue),
      sortValue: (r) => r.lead_pvalue,
      align: "right",
      mono: true,
    },
    { key: "source_tag", header: "Source", value: (r) => r.source_tag, mono: true },
  ];

  if (q.isLoading) return <Loading />;
  return (
    <DataTable
      rows={rows}
      columns={columns}
      filterKeys={["locus_name", "chromosome", "lead_rsid", "source_tag"]}
      filterPlaceholder="Filter loci…"
      onRowClick={(r) => navigate(`/explore/locus/${encodeURIComponent(r.locus_id)}`)}
      emptyMessage="No loci — build a loci mapping and rebuild derived data."
    />
  );
}

function Loading() {
  return <p className="text-sm text-base-content/40">Loading…</p>;
}
