"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type CloudStatusProps = {
  showLabel?: boolean;
  className?: string;
  onRetrySync?: () => void;
};

const getOnlineStatus = (): boolean => {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
};

export function CloudStatus({ showLabel = false, className, onRetrySync }: CloudStatusProps) {
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
    <div
      className={`cloud-status ${className ?? ""}`.trim()}
      data-state={isOnline ? "online" : "offline"}
    >
      <Link
        href="/settings#sync-status"
        className="cloud-status-link focus-ring"
        aria-label={`Sync status: ${label}`}
      >
        <Image src="/images/onedrive.svg" alt="OneDrive" width={18} height={18} />
        <span className="status-dot" aria-hidden />
        {showLabel ? <span className="status-label">{label}</span> : null}
      </Link>
      <button
        type="button"
        className="sync-button focus-ring"
        aria-label="Retry sync"
        onClick={onRetrySync}
        disabled={!onRetrySync}
      >
        Retry
      </button>
    </div>
  );
}
