import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { signIn, signOut } from "../../data/syncClient";
import { emitSessionChange, useSyncSession } from "../../hooks/useSyncSession";

const links = [
  { to: "/sources", label: "Sources" },
  { to: "/explore", label: "Explore" },
  { to: "/database", label: "Database" },
];

export function Navbar() {
  return (
    <nav className="bg-base-100">
      <div className="flex items-center h-13 px-6 w-full">
        <Link to="/" className="text-xl font-thin tracking-wide">
          <span className="text-primary font-normal">pegasus</span>
          <span className="text-base-content/30">.</span>
          <span className="text-base-content/50">v2f</span>
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-6.5">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-primary font-medium" : "text-base-content/60 hover:text-base-content"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <SyncSessionBadge />
        </div>
      </div>
    </nav>
  );
}

function SyncSessionBadge() {
  const session = useSyncSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click. mousedown so a click that lands on a
  // popover item still fires before we close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => signIn()}
        title="Sign in with GitHub to record authorship on your edits"
        className="inline-flex items-center leading-none p-0 text-sm text-base-content/60 hover:text-base-content cursor-pointer"
      >
        Sign in
      </button>
    );
  }
  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center leading-none p-0 text-sm text-base-content/70 hover:text-base-content cursor-pointer"
      >
        @{session.login}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 min-w-[10rem] rounded-md border border-base-300 bg-base-100 shadow-md py-1 text-sm">
          <a
            href={`https://github.com/${session.login}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 hover:bg-base-200 text-base-content/70 hover:text-base-content"
          >
            GitHub profile
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
              emitSessionChange();
            }}
            className="block w-full text-left px-3 py-1.5 hover:bg-base-200 text-base-content/70 hover:text-base-content cursor-pointer"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
