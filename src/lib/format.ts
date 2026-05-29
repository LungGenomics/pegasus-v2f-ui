export function formatNumber(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return String(n);
  return num.toLocaleString();
}

export function formatPvalue(p: number | string): string {
  const num = typeof p === "string" ? parseFloat(p) : p;
  if (isNaN(num)) return String(p);
  if (num === 0) return "0";
  if (num < 0.001) return num.toExponential(2);
  return num.toPrecision(3);
}

export function formatCoordinate(
  chr: string,
  start: number,
  end: number,
): string {
  // Normalize: the redesigned schema stores chromosomes as "chr1"; older data
  // used bare "1". Strip any existing prefix so we never produce "chrchr1".
  const c = String(chr).replace(/^chr/i, "");
  return `chr${c}:${formatNumber(start)}-${formatNumber(end)}`;
}

export function formatScore(s: number | string): string {
  const num = typeof s === "string" ? parseFloat(s) : s;
  if (isNaN(num)) return String(s);
  return num.toFixed(3);
}
