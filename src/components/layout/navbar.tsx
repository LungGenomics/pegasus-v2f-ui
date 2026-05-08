import { Link, NavLink } from "react-router";
import { DataSourcePicker } from "../data-source-picker";

const links = [
  { to: "/", label: "Traits" },
  { to: "/genes", label: "Genes" },
  { to: "/sources", label: "Sources" },
  { to: "/config", label: "Config" },
  { to: "/query", label: "Query" },
  { to: "/settings", label: "Settings" },
];

export function Navbar() {
  return (
    <nav className="border-b border-base-300 bg-base-100">
      <div className="flex items-center h-12 px-6 w-full">
        <Link to="/" className="text-xl font-thin text-primary tracking-wide">
          PEGASUS
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-primary font-medium" : "text-base-content/60 hover:text-base-content"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <div className="ml-4 border-l border-base-300 pl-4">
            <DataSourcePicker />
          </div>
        </div>
      </div>
    </nav>
  );
}
