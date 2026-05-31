// The app only works in Chromium-based browsers (Chrome, Edge, Brave, Arc,
// Opera) — DuckDB-WASM's read-write OPFS persistence doesn't work in Safari or
// Firefox. We detect Chromium directly rather than feature-detect, because the
// failing capability (createSyncAccessHandle read-write semantics) can't be
// reliably probed without actually booting DuckDB.

export function isSupportedBrowser(): boolean {
  if (typeof navigator === "undefined") return false;

  // userAgentData is a Chromium-only API; every Chromium browser lists a
  // "Chromium" brand. Safari and Firefox don't implement it at all.
  const brands = (
    navigator as Navigator & {
      userAgentData?: { brands?: { brand: string }[] };
    }
  ).userAgentData?.brands;
  if (brands?.length) {
    return brands.some((b) => /Chromium/i.test(b.brand));
  }

  // Fallback (older Chromium / no userAgentData): the UA string. Desktop
  // Chromium browsers all contain "Chrome/" or "Chromium/". Safari and Firefox
  // don't; iOS browsers (all WebKit, "CriOS"/"FxiOS") correctly don't match.
  return /Chrome\/|Chromium\//.test(navigator.userAgent);
}
