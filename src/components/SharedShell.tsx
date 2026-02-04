"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useSharedData } from "@/components/SharedDataProvider";

type SharedShellProps = {
  children: React.ReactNode;
};

export function SharedShell({ children }: SharedShellProps) {
  const { space, canWrite } = useSharedData();
  const pathname = usePathname();

  const basePath = useMemo(() => {
    const sharedId = space.sharedId ?? "";
    return `/shared/${encodeURIComponent(sharedId)}`;
  }, [space.sharedId]);

  const navItems = [
    { href: `${basePath}/dashboard`, label: "Overview" },
    { href: `${basePath}/accounts`, label: "Accounts" },
    { href: `${basePath}/goals`, label: "Goals" },
  ];

  return (
    <div className="section-stack">
      <section className="app-surface">
        <div className="app-muted">Shared space</div>
        <div style={{ fontWeight: 600 }}>{space.label}</div>
        <div className="app-muted">Shared ID: {space.sharedId ?? "Unknown"}</div>
        <div className="app-muted">Access: {canWrite ? "Editable" : "Read-only"}</div>
      </section>

      <nav className="app-subnav" aria-label="Shared navigation">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`subnav-link focus-ring ${isActive ? "subnav-link-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
