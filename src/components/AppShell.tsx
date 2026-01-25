"use client";

import { Switch, Text } from "@fluentui/react-components";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
        <div className="app-title">
          <Text size={500} weight="semibold">
            Piggy Bank
          </Text>
        </div>
        <Switch
          checked={mode === "dark"}
          onChange={(_, data) => onModeChange(data.checked ? "dark" : "light")}
          label="Dark mode"
        />
      </header>
      <nav className="app-nav" aria-label="Primary">
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
      </nav>
      <main className="app-main">{children}</main>
    </div>
  );
}
