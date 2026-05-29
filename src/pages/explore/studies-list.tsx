import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { listStudies, type StudyRow } from "../../data/queries/explore";
import { DataTable, type Column } from "./data-table";

export function StudiesList() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["explore", "studies"], queryFn: listStudies });
  const rows = q.data ?? [];

  const columns: Column<StudyRow>[] = [
    {
      key: "name",
      header: "Study",
      value: (r) => r.display_name || r.name,
    },
    { key: "source_tag", header: "Source tag", value: (r) => r.source_tag, mono: true },
    { key: "n_loci", header: "Loci", value: (r) => r.n_loci, align: "right", mono: true },
    {
      key: "window_kb",
      header: "Window (kb)",
      value: (r) => r.window_kb ?? "default",
      sortValue: (r) => r.window_kb,
      align: "right",
      mono: true,
    },
    {
      key: "merge_distance_kb",
      header: "Merge (kb)",
      value: (r) => r.merge_distance_kb ?? "default",
      sortValue: (r) => r.merge_distance_kb,
      align: "right",
      mono: true,
    },
  ];

  if (q.isLoading) return <p className="text-sm text-base-content/40">Loading…</p>;
  return (
    <DataTable
      rows={rows}
      columns={columns}
      filterKeys={["name", "source_tag"]}
      filterPlaceholder="Filter studies…"
      onRowClick={(r) =>
        navigate(`/explore/study/${encodeURIComponent(r.source_tag)}`)
      }
      emptyMessage="No studies — a study is a source with a loci mapping."
    />
  );
}
