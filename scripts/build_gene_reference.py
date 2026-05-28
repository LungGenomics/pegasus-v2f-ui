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
  4. Writes gencode_genes_hg38.parquet locally.
  5. Optionally uploads it to the pegasus-v2f-db R2 bucket (same bucket as the
     DB sync) when R2 credentials are present in the environment.

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
  public URL  https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev/reference/gencode_genes_hg38.parquet
The public URL is what goes in config.pegasus_settings.gene_reference_url.
"""

from __future__ import annotations

import argparse
import gzip
import io
import os
import re
import sys

import pandas as pd
import requests

GENCODE_BASE = "https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human"
LATEST_DIR = f"{GENCODE_BASE}/latest_release/"

R2_BUCKET = "pegasus-v2f-db"
R2_KEY = "reference/gencode_genes_hg38.parquet"
R2_PUBLIC_BASE = "https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev"
OUT_FILE = "gencode_genes_hg38.parquet"


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


def upload(path: str) -> None:
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
    print(f"[gene-ref] public URL: {R2_PUBLIC_BASE}/{R2_KEY}")


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

    if args.upload:
        upload(args.out)
    else:
        print(
            "[gene-ref] built locally; re-run with --upload (and R2_* env vars) "
            "to push to R2.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
