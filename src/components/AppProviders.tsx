"use client";

import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/components/AuthProvider";
import { PersonalDataProvider } from "@/components/PersonalDataProvider";
import { SharedSelectionProvider } from "@/components/SharedSelectionProvider";

const THEME_STORAGE_KEY = "mazemaze-piggy-bank-theme";

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | ThemeMode;

type ThemeContextValue = {
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const getSystemMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("Theme context is missing.");
  }
  return value;
};

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") {
      return "system";
    }
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  });

  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    if (preference === "light" || preference === "dark") {
      return preference;
    }
    return getSystemMode();
  });

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    if (preference === "system") {
      setMode(getSystemMode());
    } else {
      setMode(preference);
    }
  }, [preference]);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  useEffect(() => {
    if (preference !== "system") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setMode(getSystemMode());
    mediaQuery.addEventListener("change", handler);
    return () => {
      mediaQuery.removeEventListener("change", handler);
    };
  }, [preference]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const theme = useMemo(() => (mode === "dark" ? webDarkTheme : webLightTheme), [mode]);

  return (
    <FluentProvider theme={theme}>
      <ThemeContext.Provider value={{ mode, preference, setPreference }}>
        <AuthProvider>
          <SharedSelectionProvider>
            <PersonalDataProvider>
              <AppShell>{children}</AppShell>
            </PersonalDataProvider>
          </SharedSelectionProvider>
        </AuthProvider>
      </ThemeContext.Provider>
    </FluentProvider>
  );
}
