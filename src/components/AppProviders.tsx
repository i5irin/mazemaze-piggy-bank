"use client";

import {
  FluentProvider,
  SSRProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/components/AuthProvider";
import { PersonalDataProvider } from "@/components/PersonalDataProvider";
import { StorageProviderContextProvider } from "@/components/StorageProviderContext";
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

const lightTheme = {
  ...webLightTheme,
  colorBrandBackground: "#f6e58d",
  colorBrandBackground2: "#f1df83",
  colorBrandBackgroundHover: "#e7d173",
  colorBrandBackgroundPressed: "#d9be59",
  colorBrandForeground1: "#626258",
  colorBrandForeground2: "#56564d",
  colorBrandForegroundLink: "#626258",
  colorBrandForegroundLinkHover: "#4f4f46",
  colorBrandForegroundLinkPressed: "#3f3f38",
  colorBrandStroke1: "#b7a862",
  colorBrandStroke2: "#d2c273",
  colorCompoundBrandBackground: "#f6e58d",
  colorCompoundBrandBackgroundHover: "#e7d173",
  colorCompoundBrandBackgroundPressed: "#d9be59",
  colorCompoundBrandStroke: "#b7a862",
  colorCompoundBrandStrokeHover: "#a39457",
  colorCompoundBrandStrokePressed: "#8f824d",
  colorNeutralForegroundOnBrand: "#1a1a16",
  colorStrokeFocus1: "#f5f5f2",
  colorStrokeFocus2: "#f6e58d",
};

const darkTheme = {
  ...webDarkTheme,
  colorBrandBackground: "#f6e58d",
  colorBrandBackground2: "#f1df83",
  colorBrandBackgroundHover: "#e7d173",
  colorBrandBackgroundPressed: "#d9be59",
  colorBrandForeground1: "#f5f5f2",
  colorBrandForeground2: "#e6e6de",
  colorBrandForegroundLink: "#f6e58d",
  colorBrandForegroundLinkHover: "#f1df83",
  colorBrandForegroundLinkPressed: "#e7d173",
  colorBrandStroke1: "#f1df83",
  colorBrandStroke2: "#d2c273",
  colorCompoundBrandBackground: "#f6e58d",
  colorCompoundBrandBackgroundHover: "#e7d173",
  colorCompoundBrandBackgroundPressed: "#d9be59",
  colorCompoundBrandStroke: "#f1df83",
  colorCompoundBrandStrokeHover: "#e7d173",
  colorCompoundBrandStrokePressed: "#d9be59",
  colorNeutralForegroundOnBrand: "#1a1a16",
  colorStrokeFocus1: "#1e1e1b",
  colorStrokeFocus2: "#f6e58d",
};

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

  const [systemMode, setSystemMode] = useState<ThemeMode>(() => getSystemMode());
  const mode: ThemeMode = preference === "system" ? systemMode : preference;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  useEffect(() => {
    if (preference !== "system") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemMode(getSystemMode());
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

  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);

  return (
    <SSRProvider>
      <FluentProvider theme={theme}>
        <ThemeContext.Provider value={{ mode, preference, setPreference }}>
          <AuthProvider>
            <StorageProviderContextProvider>
              <SharedSelectionProvider>
                <PersonalDataProvider>
                  <AppShell>{children}</AppShell>
                </PersonalDataProvider>
              </SharedSelectionProvider>
            </StorageProviderContextProvider>
          </AuthProvider>
        </ThemeContext.Provider>
      </FluentProvider>
    </SSRProvider>
  );
}
