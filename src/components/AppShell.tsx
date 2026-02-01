"use client";

import { Switch } from "@fluentui/react-components";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusIndicator } from "@/components/StatusIndicator";

type ThemeMode = "light" | "dark";

type AppShellProps = {
  children: ReactNode;
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts", label: "Accounts" },
  { href: "/goals", label: "Goals" },
  { href: "/shared", label: "Shared" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children, mode, onModeChange }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left" />
        <div className="app-header-center">
          <Link href="/dashboard" className="brand-link" aria-label="Mazemaze Piggy Bank">
            <Image
              src="/images/lockup-horizontal.svg"
              alt="Mazemaze Piggy Bank"
              width={220}
              height={40}
              priority
              className="brand-logo brand-logo-light"
            />
            <Image
              src="/images/lockup-horizontal-dark.svg"
              alt="Mazemaze Piggy Bank"
              width={220}
              height={40}
              priority
              className="brand-logo brand-logo-dark"
            />
          </Link>
        </div>
        <div className="app-header-right">
          <StatusIndicator className="status-indicator-header" />
          <Switch
            checked={mode === "dark"}
            onChange={(_, data) => onModeChange(data.checked ? "dark" : "light")}
            label="Dark mode"
          />
        </div>
      </header>
      <nav className="app-nav" aria-label="Primary">
        <div className="app-nav-brand">
          <Link href="/dashboard" className="brand-link" aria-label="Mazemaze Piggy Bank">
            <Image
              src="/images/lockup-horizontal.svg"
              alt="Mazemaze Piggy Bank"
              width={200}
              height={36}
              className="brand-logo brand-logo-light"
            />
            <Image
              src="/images/lockup-horizontal-dark.svg"
              alt="Mazemaze Piggy Bank"
              width={200}
              height={36}
              className="brand-logo brand-logo-dark"
            />
          </Link>
        </div>
        <div className="app-nav-links">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === "/dashboard" && pathname === "/") ||
              (item.href === "/shared" && pathname.startsWith("/shared"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link focus-ring ${isActive ? "nav-link-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="app-nav-footer">
          <StatusIndicator showLabel />
        </div>
      </nav>
      <main className="app-main">{children}</main>
    </div>
  );
}
