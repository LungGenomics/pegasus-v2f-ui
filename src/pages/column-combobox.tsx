// Column input + capped autocomplete popup. Replaces the native <datalist>
// dropdown used by the transform/mapping forms — datalist's height isn't
// capped by Chrome on macOS, so a source with many columns produced a popup
// that filled the page. This component renders an input + a max-height
// dropdown that filters by current value, all inline (no portal).
//
// Free typing is preserved: the input mirrors `value` directly and onChange
// fires per keystroke. Clicking a suggestion sets `value` and closes.

import { useEffect, useRef, useState } from "react";

export function ColumnCombobox({
  value,
  onChange,
  columns,
  placeholder = "column",
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  columns: string[];
  placeholder?: string;
  /** Tint the input as a warning (e.g. the typed column isn't in the
   *  schema). Purely visual — doesn't block input. */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click. mousedown (not click) so a click that lands on
  // an option still selects it before we close (the option uses mousedown).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = value.trim().toLowerCase();
  const options = q
    ? columns.filter((c) => c.toLowerCase().includes(q))
    : columns;
  // Suppress the dropdown when the value is already an exact, single match —
  // no need to show a 1-item popup that just re-suggests what's typed.
  const hideExactMatch =
    options.length === 1 && options[0]!.toLowerCase() === q;
  const showList = open && options.length > 0 && !hideExactMatch;

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={`input input-bordered input-sm w-full font-mono ${
          invalid ? "input-warning" : ""
        }`}
      />
      {showList && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-auto border border-base-300 rounded-md bg-base-100 shadow-md text-xs font-mono">
          {options.map((c) => (
            <li
              key={c}
              // mousedown (not click) so we select before the input's blur
              // unmounts us.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c);
                setOpen(false);
              }}
              className={`px-2 py-1 cursor-pointer hover:bg-base-200 ${
                c === value ? "bg-base-200" : ""
              }`}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
