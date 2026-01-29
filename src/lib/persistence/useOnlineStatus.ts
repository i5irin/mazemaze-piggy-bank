"use client";

import { useEffect, useState } from "react";

export const useOnlineStatus = (): boolean => {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const timerId = window.setTimeout(() => {
      setIsOnline(navigator.onLine);
    }, 0);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
};
