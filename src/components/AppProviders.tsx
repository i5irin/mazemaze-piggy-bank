"use client";

import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "piggy-bank-theme";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const theme = useMemo(
    () => (mode === "dark" ? webDarkTheme : webLightTheme),
    [mode],
  );

  return (
    <FluentProvider theme={theme}>
      <AppShell mode={mode} onModeChange={setMode}>
        {children}
      </AppShell>
    </FluentProvider>
  );
}
