"use client";

import {
  Home24Regular,
  Grid24Regular,
  Wallet24Regular,
  Target24Regular,
  People24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CloudStatus } from "@/components/StatusIndicator";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: Grid24Regular,
    mobileIcon: Home24Regular,
  },
  { href: "/accounts", label: "Accounts", icon: Wallet24Regular },
  { href: "/goals", label: "Goals", icon: Target24Regular },
  { href: "/shared", label: "Shared", icon: People24Regular },
  { href: "/settings", label: "Settings", icon: Settings24Regular },
];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleRetrySync = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem("sync-retry", String(Date.now()));
    window.dispatchEvent(new Event("sync-retry"));
    if (!pathname.startsWith("/settings")) {
      router.push("/settings#sync-status");
    }
  };

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
          <CloudStatus className="status-indicator-header" onRetrySync={handleRetrySync} />
        </div>
      </header>
      <main className="app-main">{children}</main>
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
            const Icon = item.icon;
            const MobileIcon = item.mobileIcon ?? item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link focus-ring ${isActive ? "nav-link-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="nav-icon nav-icon-mobile" aria-hidden>
                  <MobileIcon />
                </span>
                <span className="nav-icon nav-icon-desktop" aria-hidden>
                  <Icon />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="app-nav-footer">
          <CloudStatus showLabel onRetrySync={handleRetrySync} />
        </div>
      </nav>
    </div>
  );
}
