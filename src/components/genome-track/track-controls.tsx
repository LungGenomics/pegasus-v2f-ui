import { useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  chromNames: string[];
  onChromSelect: (chr: string) => void;
  onRegionInput: (chr: string, start: number, end: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onPrevLocus: () => void;
  onNextLocus: () => void;
  hasLoci: boolean;
};

/**
 * Compact navigation controls for the genome track.
 */
export function TrackControls({
  chromNames,
  onChromSelect,
  onRegionInput,
  onZoomIn,
  onZoomOut,
  onReset,
  onPrevLocus,
  onNextLocus,
  hasLoci,
}: Props) {
  const [regionText, setRegionText] = useState("");

  const handleRegionSubmit = () => {
    const parsed = parseRegion(regionText);
    if (parsed) {
      onRegionInput(parsed.chr, parsed.start, parsed.end);
      setRegionText("");
    }
  };

  return (
    <div className="flex items-center gap-2 text-base-content/50">
      {/* Chromosome + region input group */}
      <div className="join">
        <select
          className="select select-bordered select-xs join-item w-24"
          onChange={(e) => onChromSelect(e.target.value)}
          defaultValue=""
        >
          <option value="">All chr</option>
          {chromNames.map((name) => (
            <option key={name} value={name}>
              {name.replace("chr", "Chr ")}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="input input-bordered input-xs join-item w-32 placeholder:text-base-content/30"
          placeholder="chr2:150M-160M"
          value={regionText}
          onChange={(e) => setRegionText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRegionSubmit();
          }}
        />
      </div>

      {/* Zoom controls */}
      <div className="flex items-center">
        <button
          className="p-1 rounded hover:bg-base-200 hover:text-base-content transition-colors"
          onClick={onZoomOut}
          title="Zoom out (-)"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <button
          className="p-1 rounded hover:bg-base-200 hover:text-base-content transition-colors"
          onClick={onZoomIn}
          title="Zoom in (+)"
        >
          <ZoomIn className="size-3.5" />
        </button>
        <button
          className="p-1 rounded hover:bg-base-200 hover:text-base-content transition-colors"
          onClick={onReset}
          title="Reset (Esc)"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      {/* Locus stepper */}
      {hasLoci && (
        <div className="flex items-center">
          <button
            className="p-1 rounded hover:bg-base-200 hover:text-base-content transition-colors"
            onClick={onPrevLocus}
            title="Previous locus (←)"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            className="p-1 rounded hover:bg-base-200 hover:text-base-content transition-colors"
            onClick={onNextLocus}
            title="Next locus (→)"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Parse region strings like "chr2:150000000-160000000" or "chr2:150M-160M".
 */
function parseRegion(
  text: string,
): { chr: string; start: number; end: number } | null {
  const match = text
    .trim()
    .match(/^(chr[\dXY]+):([0-9.]+[MmKk]?)-([0-9.]+[MmKk]?)$/i);
  if (!match) return null;

  const chr = match[1]!.toLowerCase().replace("chr", "chr");
  const start = parseBp(match[2]!);
  const end = parseBp(match[3]!);

  if (isNaN(start) || isNaN(end) || start >= end) return null;
  return { chr: `chr${chr.replace("chr", "")}`, start, end };
}

function parseBp(s: string): number {
  const lower = s.toLowerCase();
  if (lower.endsWith("m")) return parseFloat(s) * 1_000_000;
  if (lower.endsWith("k")) return parseFloat(s) * 1_000;
  return parseInt(s, 10);
}
