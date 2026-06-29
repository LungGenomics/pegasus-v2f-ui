# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "requests", "boto3"]
# ///
"""
Build the hg38 gene-coordinate parquet that the Explore data layer reads as
its gene reference (plan 2026-05-28-explore-data-layer.md).

What it does:
  1. Discovers the latest GENCODE human release (or uses --release).
  2. Downloads that release's comprehensive annotation GTF.
  3. Keeps feature == "gene", extracts the columns the candidate-gene overlap
     needs: gene_symbol, ensembl_gene_id, chromosome, start, end, strand,
     gene_type.
  4. Writes gencode_genes_hg38.parquet locally, plus a sidecar
     gencode_genes_hg38.meta.json describing it (version/release/counts). The
     UI imports the sidecar so the displayed GENCODE version can't drift from
     the actual data — both are written in this one run.
  5. Optionally uploads BOTH the parquet and the sidecar to the pegasus-v2f-db
     R2 bucket (same bucket as the DB sync) when R2 credentials are present.

Chromosome format: GENCODE uses UCSC style ("chr1", "chrX"), which is the
canonical internal format the loci/evidence side aligns to (via add_prefix on
sources that ship bare "1"). No renaming here.

Coordinates: GTF is 1-based, inclusive (columns 4/5) — fine for interval
overlap against loci start/end.

Usage:
  uv run scripts/build_gene_reference.py                 # build only
  uv run scripts/build_gene_reference.py --release 47    # pin a release
  # upload (reads creds from env — never hardcode):
  R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=... \
    uv run scripts/build_gene_reference.py --upload

R2 target (matches repos/pegasus-v2f-sync/wrangler.toml):
  bucket      pegasus-v2f-db
  key         reference/gencode_genes_hg38.parquet
              reference/gencode_genes_hg38.meta.json   (sidecar)
  public URL  https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev/reference/gencode_genes_hg38.parquet
The public URL is what goes in config.pegasus_settings.gene_reference_url.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import re
import sys

import pandas as pd
import requests

GENCODE_BASE = "https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human"
LATEST_DIR = f"{GENCODE_BASE}/latest_release/"

R2_BUCKET = "pegasus-v2f-db"
R2_KEY = "reference/gencode_genes_hg38.parquet"
R2_META_KEY = "reference/gencode_genes_hg38.meta.json"
R2_PUBLIC_BASE = "https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev"
OUT_FILE = "gencode_genes_hg38.parquet"


def meta_path_for(parquet_path: str) -> str:
    """Sidecar path: foo.parquet → foo.meta.json (alongside the parquet)."""
    base = (
        parquet_path[: -len(".parquet")]
        if parquet_path.endswith(".parquet")
        else parquet_path
    )
    return f"{base}.meta.json"


def build_meta(release: int, df: pd.DataFrame) -> dict:
    """Provenance for the parquet — deterministic for a given release, so
    re-running the same release produces an identical sidecar (no churn)."""
    return {
        "version": f"GENCODE v{release}",
        "release": release,
        "genome_build": "hg38",
        "n_genes": int(len(df)),
        "n_biotypes": int(df["gene_type"].nunique()),
        "source_url": gtf_url(release),
    }


def discover_latest_release() -> int:
    """Scrape the latest_release directory listing for the release number."""
    resp = requests.get(LATEST_DIR, timeout=60)
    resp.raise_for_status()
    versions = re.findall(r"gencode\.v(\d+)\.annotation\.gtf\.gz", resp.text)
    if not versions:
        raise RuntimeError(
            f"Could not find a gencode.vNN.annotation.gtf.gz in {LATEST_DIR}"
        )
    return max(int(v) for v in versions)


def gtf_url(release: int) -> str:
    return (
        f"{GENCODE_BASE}/release_{release}/"
        f"gencode.v{release}.annotation.gtf.gz"
    )


# GTF column 9 is "key1 \"val1\"; key2 \"val2\"; ...". Pull just what we need.
def _attr(attrs: str, key: str) -> str | None:
    m = re.search(rf'{key} "([^"]*)"', attrs)
    return m.group(1) if m else None


def build(release: int) -> pd.DataFrame:
    url = gtf_url(release)
    print(f"[gene-ref] downloading {url}", file=sys.stderr)
    resp = requests.get(url, timeout=600)
    resp.raise_for_status()

    print("[gene-ref] parsing GTF (gene features)…", file=sys.stderr)
    with gzip.open(io.BytesIO(resp.content), "rt") as fh:
        df = pd.read_csv(
            fh,
            sep="\t",
            comment="#",
            header=None,
            names=[
                "chromosome",
                "source",
                "feature",
                "start",
                "end",
                "score",
                "strand",
                "frame",
                "attributes",
            ],
            dtype={"chromosome": str},
        )

    genes = df[df["feature"] == "gene"].copy()
    genes["ensembl_gene_id"] = genes["attributes"].map(
        lambda a: _attr(a, "gene_id")
    )
    genes["gene_symbol"] = genes["attributes"].map(lambda a: _attr(a, "gene_name"))
    genes["gene_type"] = genes["attributes"].map(lambda a: _attr(a, "gene_type"))

    out = genes[
        [
            "gene_symbol",
            "ensembl_gene_id",
            "chromosome",
            "start",
            "end",
            "strand",
            "gene_type",
        ]
    ].reset_index(drop=True)
    out["start"] = out["start"].astype("int64")
    out["end"] = out["end"].astype("int64")

    n_biotypes = out["gene_type"].nunique()
    print(
        f"[gene-ref] {len(out):,} genes, {n_biotypes} biotypes "
        f"(release v{release})",
        file=sys.stderr,
    )
    return out


def upload(path: str, meta_path: str) -> None:
    import boto3

    account = os.environ["R2_ACCOUNT_ID"]
    key_id = os.environ["R2_ACCESS_KEY_ID"]
    secret = os.environ["R2_SECRET_ACCESS_KEY"]
    endpoint = f"https://{account}.r2.cloudflarestorage.com"

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    print(f"[gene-ref] uploading → {R2_BUCKET}/{R2_KEY}", file=sys.stderr)
    s3.upload_file(
        path,
        R2_BUCKET,
        R2_KEY,
        ExtraArgs={"ContentType": "application/octet-stream"},
    )
    print(f"[gene-ref] uploading → {R2_BUCKET}/{R2_META_KEY}", file=sys.stderr)
    s3.upload_file(
        meta_path,
        R2_BUCKET,
        R2_META_KEY,
        ExtraArgs={"ContentType": "application/json"},
    )
    print(f"[gene-ref] public URLs:")
    print(f"  {R2_PUBLIC_BASE}/{R2_KEY}")
    print(f"  {R2_PUBLIC_BASE}/{R2_META_KEY}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the hg38 gene-reference parquet.")
    ap.add_argument(
        "--release",
        type=int,
        default=None,
        help="GENCODE human release number (default: latest)",
    )
    ap.add_argument("--out", default=OUT_FILE, help=f"output path (default {OUT_FILE})")
    ap.add_argument(
        "--upload",
        action="store_true",
        help="upload to R2 (needs R2_* env vars)",
    )
    args = ap.parse_args()

    release = args.release or discover_latest_release()
    df = build(release)
    df.to_parquet(args.out, index=False)
    print(f"[gene-ref] wrote {args.out}", file=sys.stderr)

    meta_path = meta_path_for(args.out)
    with open(meta_path, "w") as fh:
        json.dump(build_meta(release, df), fh, indent=2)
        fh.write("\n")
    print(f"[gene-ref] wrote {meta_path}", file=sys.stderr)

    if args.upload:
        upload(args.out, meta_path)
    else:
        print(
            "[gene-ref] built locally; re-run with --upload (and R2_* env vars) "
            "to push to R2.\n"
            "[gene-ref] NOTE: copy BOTH files into the UI bundle "
            "(src/data/gene_reference.parquet and .meta.json) to ship them.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
