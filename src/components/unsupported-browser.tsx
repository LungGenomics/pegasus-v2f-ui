// Full-page block shown when the browser isn't Chromium-based (see
// lib/browser-support.ts). Renders instead of the app — no navbar, no boot.
// Styled to match the bedbase-ui ErrorBoundary page (iconless).

export function UnsupportedBrowser() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh gap-4 px-4 pb-16">
      <h1 className="text-xl font-light text-base-content">Browser not supported.</h1>
      <p className="text-xs text-base-content/50 max-w-md text-center">
        pegasus-v2f runs its database in your browser and needs local-file
        storage that only Chromium-based browsers support. Please open it in
        Chrome, Edge, Brave, Arc, or Opera.
      </p>
    </div>
  );
}
