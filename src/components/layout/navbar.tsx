import { Link, NavLink } from "react-router";

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
        </div>
      </div>
    </nav>
  );
}
