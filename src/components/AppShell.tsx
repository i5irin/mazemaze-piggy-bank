"use client";

import {
  Home24Regular,
  Grid24Regular,
  Wallet24Regular,
  Target24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useSharedSelection } from "@/components/SharedSelectionProvider";
import { CloudStatus } from "@/components/StatusIndicator";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { createOneDriveService, type SharedRootListItem } from "@/lib/onedrive/oneDriveService";
import { useOnlineStatus } from "@/lib/persistence/useOnlineStatus";

type AppShellProps = {
  children: ReactNode;
};

type AppSection = "dashboard" | "accounts" | "goals" | "settings";

type SharedOption = {
  sharedId: string;
  driveId: string;
  itemId: string;
  name: string;
  webUrl?: string;
};

const navItems: {
  section: AppSection;
  label: string;
  icon: typeof Grid24Regular;
  mobileIcon?: typeof Grid24Regular;
}[] = [
  {
    section: "dashboard",
    label: "Dashboard",
    icon: Grid24Regular,
    mobileIcon: Home24Regular,
  },
  { section: "accounts", label: "Accounts", icon: Wallet24Regular },
  { section: "goals", label: "Goals", icon: Target24Regular },
  { section: "settings", label: "Settings", icon: Settings24Regular },
];

const mergeSharedOptions = (
  selection: SharedOption | null,
  roots: SharedRootListItem[],
  activeSharedId: string | null,
): SharedOption[] => {
  const byId = new Map<string, SharedOption>();
  if (selection) {
    byId.set(selection.sharedId, selection);
  }
  for (const root of roots) {
    byId.set(root.sharedId, {
      sharedId: root.sharedId,
      driveId: root.driveId,
      itemId: root.itemId,
      name: root.name,
      webUrl: root.webUrl,
    });
  }
  if (activeSharedId && !byId.has(activeSharedId)) {
    byId.set(activeSharedId, {
      sharedId: activeSharedId,
      driveId: "",
      itemId: "",
      name: "Current shared space",
    });
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { status: authStatus, getAccessToken } = useAuth();
  const { selection, setSelection } = useSharedSelection();
  const isOnline = useOnlineStatus();
  const isSignedIn = authStatus === "signed_in";
  const [sharedRoots, setSharedRoots] = useState<SharedRootListItem[]>([]);
  const [sharedRootsStatus, setSharedRootsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const graphScopes = useMemo(() => getGraphScopes(), []);
  const tokenProvider = useCallback((scopes: string[]) => getAccessToken(scopes), [getAccessToken]);
  const graphClient = useMemo(
    () =>
      createGraphClient({
        accessTokenProvider: tokenProvider,
      }),
    [tokenProvider],
  );
  const oneDrive = useMemo(
    () => createOneDriveService(graphClient, graphScopes),
    [graphClient, graphScopes],
  );

  const pathSegments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);
  const isSharedRoute = pathSegments[0] === "shared" && pathSegments.length >= 2;
  const activeSharedId = isSharedRoute ? decodeURIComponent(pathSegments[1]) : null;
  const sectionCandidate = isSharedRoute
    ? (pathSegments[2] ?? "dashboard")
    : (pathSegments[0] ?? "dashboard");
  const currentSection: AppSection =
    sectionCandidate === "accounts" ||
    sectionCandidate === "goals" ||
    sectionCandidate === "settings" ||
    sectionCandidate === "dashboard"
      ? sectionCandidate
      : "dashboard";
  const activeScope: "personal" | "shared" = isSharedRoute ? "shared" : "personal";

  const sharedOptions = useMemo(() => {
    const selectedOption = selection
      ? {
          sharedId: selection.sharedId,
          driveId: selection.driveId,
          itemId: selection.itemId,
          name: selection.name,
          webUrl: selection.webUrl,
        }
      : null;
    return mergeSharedOptions(selectedOption, sharedRoots, activeSharedId);
  }, [activeSharedId, selection, sharedRoots]);
  const selectedSharedId = activeSharedId ?? selection?.sharedId ?? "";

  const toScopedPath = useCallback(
    (scope: "personal" | "shared", sharedId?: string): string => {
      if (scope === "personal") {
        return currentSection === "dashboard" ? "/dashboard" : `/${currentSection}`;
      }
      const targetSection: AppSection =
        currentSection === "settings" ? "dashboard" : currentSection;
      if (!sharedId) {
        return "/dashboard";
      }
      return `/shared/${encodeURIComponent(sharedId)}/${targetSection}`;
    },
    [currentSection],
  );

  const dashboardHref =
    activeScope === "shared" && selectedSharedId
      ? `/shared/${encodeURIComponent(selectedSharedId)}/dashboard`
      : "/dashboard";

  const loadSharedRoots = useCallback(async (): Promise<SharedRootListItem[]> => {
    if (!isSignedIn || !isOnline) {
      setSharedRoots([]);
      setSharedRootsStatus("idle");
      return [];
    }
    setSharedRootsStatus("loading");
    try {
      const [withMe, byMe] = await Promise.all([
        oneDrive.listSharedWithMeRoots(),
        oneDrive.listSharedByMeRoots(),
      ]);
      const byId = new Map<string, SharedRootListItem>();
      for (const root of [...withMe, ...byMe]) {
        byId.set(root.sharedId, root);
      }
      const merged = [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
      setSharedRoots(merged);
      setSharedRootsStatus("ready");
      return merged;
    } catch {
      setSharedRootsStatus("error");
      return [];
    }
  }, [isOnline, isSignedIn, oneDrive]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      if (isSignedIn && isOnline) {
        void loadSharedRoots();
        return;
      }
      setSharedRoots([]);
      setSharedRootsStatus("idle");
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [isOnline, isSignedIn, loadSharedRoots]);

  const resolveSharedTarget = useCallback(
    async (preferredId?: string): Promise<SharedOption | null> => {
      if (preferredId) {
        const preferred = sharedOptions.find((option) => option.sharedId === preferredId);
        if (preferred) {
          return preferred;
        }
      }
      if (selection) {
        return {
          sharedId: selection.sharedId,
          driveId: selection.driveId,
          itemId: selection.itemId,
          name: selection.name,
          webUrl: selection.webUrl,
        };
      }
      if (sharedOptions.length > 0) {
        return sharedOptions[0];
      }
      const loaded = await loadSharedRoots();
      const first = loaded[0];
      if (!first) {
        return null;
      }
      return {
        sharedId: first.sharedId,
        driveId: first.driveId,
        itemId: first.itemId,
        name: first.name,
        webUrl: first.webUrl,
      };
    },
    [loadSharedRoots, selection, sharedOptions],
  );

  const handleScopeSwitch = useCallback(
    (scope: "personal" | "shared") => {
      if (scope === "personal") {
        router.push(toScopedPath("personal"));
        return;
      }
      void (async () => {
        const target = await resolveSharedTarget(activeSharedId ?? selection?.sharedId);
        if (!target) {
          router.push("/settings#shared-scopes");
          return;
        }
        setSelection({
          sharedId: target.sharedId,
          driveId: target.driveId,
          itemId: target.itemId,
          name: target.name,
          webUrl: target.webUrl,
        });
        router.push(toScopedPath("shared", target.sharedId));
      })();
    },
    [activeSharedId, resolveSharedTarget, router, selection?.sharedId, setSelection, toScopedPath],
  );

  const handleSharedSelect = useCallback(
    (nextSharedId: string) => {
      const target = sharedOptions.find((option) => option.sharedId === nextSharedId);
      if (!target) {
        return;
      }
      setSelection({
        sharedId: target.sharedId,
        driveId: target.driveId,
        itemId: target.itemId,
        name: target.name,
        webUrl: target.webUrl,
      });
      router.push(toScopedPath("shared", target.sharedId));
    },
    [router, setSelection, sharedOptions, toScopedPath],
  );

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

  const renderScopeSwitcher = (className?: string) =>
    (() => {
      const isSharedScope = activeScope === "shared";
      const sharedSelectDisabled =
        !isSharedScope ||
        !isSignedIn ||
        !isOnline ||
        (sharedOptions.length === 0 && sharedRootsStatus !== "loading");
      const sharedPlaceholder = !isSharedScope
        ? "Switch to Shared to choose a folder"
        : sharedRootsStatus === "loading"
          ? "Loading shared folders..."
          : sharedOptions.length === 0
            ? "No shared folders"
            : "Select shared folder";

      return (
        <div className={`scope-switcher ${className ?? ""}`.trim()}>
          <div className="scope-pivot" role="tablist" aria-label="Data scope">
            <button
              type="button"
              className={`scope-pivot-button ${activeScope === "personal" ? "is-active" : ""}`}
              onClick={() => handleScopeSwitch("personal")}
              role="tab"
              aria-selected={activeScope === "personal"}
            >
              Personal
            </button>
            <button
              type="button"
              className={`scope-pivot-button ${activeScope === "shared" ? "is-active" : ""}`}
              onClick={() => handleScopeSwitch("shared")}
              role="tab"
              aria-selected={activeScope === "shared"}
            >
              Shared
            </button>
          </div>
          <select
            className="scope-select"
            value={selectedSharedId}
            onChange={(event) => handleSharedSelect(event.target.value)}
            onFocus={() => {
              if (sharedRootsStatus === "idle") {
                void loadSharedRoots();
              }
            }}
            disabled={sharedSelectDisabled}
            aria-label="Shared root"
          >
            <option value="">{sharedPlaceholder}</option>
            {sharedOptions.map((option) => (
              <option key={option.sharedId} value={option.sharedId}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      );
    })();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">{renderScopeSwitcher("scope-switcher-mobile")}</div>
        <div className="app-header-center">
          <Link href={dashboardHref} className="brand-link" aria-label="Mazemaze Piggy Bank">
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
          <Link href={dashboardHref} className="brand-link" aria-label="Mazemaze Piggy Bank">
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
        <div className="app-nav-scope">{renderScopeSwitcher("scope-switcher-desktop")}</div>
        <div className="app-nav-links">
          {navItems.map((item) => {
            const href =
              item.section === "settings"
                ? "/settings"
                : activeScope === "shared" && selectedSharedId
                  ? `/shared/${encodeURIComponent(selectedSharedId)}/${item.section}`
                  : item.section === "dashboard"
                    ? "/dashboard"
                    : `/${item.section}`;
            const isActive =
              item.section === "settings"
                ? pathname.startsWith("/settings")
                : currentSection === item.section;
            const Icon = item.icon;
            const MobileIcon = item.mobileIcon ?? item.icon;
            return (
              <Link
                key={item.section}
                href={href}
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
