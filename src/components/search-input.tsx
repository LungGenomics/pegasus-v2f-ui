import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  debounceMs = 300,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function handleChange(v: string) {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), debounceMs);
  }

  return (
    <div className="flex items-center gap-2.5 border border-base-300 bg-base-100 rounded-lg px-3.5 py-2.5 focus-within:border-primary/40 transition-colors">
      <Search className="size-4 text-base-content/30 shrink-0" />
      <input
        type="text"
        className="grow bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/40"
        placeholder={placeholder}
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  );
}
