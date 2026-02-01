"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StatusIndicatorProps = {
  showLabel?: boolean;
  className?: string;
};

const getOnlineStatus = (): boolean => {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
};

export function StatusIndicator({ showLabel = false, className }: StatusIndicatorProps) {
  const [isOnline, setIsOnline] = useState<boolean>(getOnlineStatus);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const label = isOnline ? "Online" : "Offline";

  return (
    <Link
      href="/settings#sync-status"
      className={`status-indicator focus-ring ${className ?? ""}`.trim()}
      data-state={isOnline ? "online" : "offline"}
      aria-label={`Sync status: ${label}`}
    >
      <span className="status-dot" aria-hidden />
      {showLabel ? <span className="status-label">{label}</span> : null}
    </Link>
  );
}
