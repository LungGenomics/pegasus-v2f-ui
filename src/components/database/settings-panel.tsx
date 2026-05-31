// Settings (Database page): loci defaults (window_kb / merge_distance_kb) used
// as the fallback when a loci mapping leaves them blank, + the (fixed) genome
// build. Saving the loci defaults marks the derived layer for a rebuild via
// the dirty path (they feed loci geometry).

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPegasusSettings, updatePegasusSettings } from "../../data/settingsOps";
import { useSyncSession } from "../../hooks/useSyncSession";

export function SettingsPanel() {
  const qc = useQueryClient();
  const session = useSyncSession();
  const settingsQ = useQuery({
    queryKey: ["pegasus-settings"],
    queryFn: getPegasusSettings,
  });

  const [windowKb, setWindowKb] = useState("");
  const [mergeKb, setMergeKb] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsQ.data) {
      setWindowKb(String(settingsQ.data.window_kb));
      setMergeKb(String(settingsQ.data.merge_distance_kb));
    }
  }, [settingsQ.data]);

  const wNum = Number.parseInt(windowKb, 10);
  const mNum = Number.parseInt(mergeKb, 10);
  const valid = Number.isFinite(wNum) && wNum > 0 && Number.isFinite(mNum) && mNum >= 0;
  const dirty =
    settingsQ.data != null &&
    (wNum !== settingsQ.data.window_kb || mNum !== settingsQ.data.merge_distance_kb);

  const save = async () => {
    if (!valid) return;
    await updatePegasusSettings(
      { window_kb: wNum, merge_distance_kb: mNum },
      session?.login ?? null,
    );
    void qc.invalidateQueries({ queryKey: ["pegasus-settings"] });
    void qc.invalidateQueries({ queryKey: ["config"] });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-base-content/70 mb-1">
          Loci defaults
        </h3>
        <p className="text-xs text-base-content/50 mb-3">
          Fallback window + merge distance for loci mappings that don't set
          their own. Changing these requires a rebuild (Gene reference → Save).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-base-content/50 mb-1">
              Window (kb)
            </span>
            <input
              type="number"
              min={1}
              value={windowKb}
              onChange={(e) => setWindowKb(e.target.value)}
              className="input input-bordered input-sm w-full font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-base-content/50 mb-1">
              Merge distance (kb)
            </span>
            <input
              type="number"
              min={0}
              value={mergeKb}
              onChange={(e) => setMergeKb(e.target.value)}
              className="input input-bordered input-sm w-full font-mono text-xs"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!valid || !dirty}
          className="btn btn-neutral btn-sm mt-3"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
