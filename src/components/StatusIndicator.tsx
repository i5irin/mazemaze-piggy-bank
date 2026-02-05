"use client";

import Link from "next/link";
import { getSyncIndicatorMeta, type SyncIndicatorState } from "@/lib/persistence/syncStatus";

type StatusIndicatorProps = {
  state: SyncIndicatorState;
  className?: string;
  href?: string;
};

export function StatusIndicator({
  state,
  className,
  href = "/settings#connection-health",
}: StatusIndicatorProps) {
  const meta = getSyncIndicatorMeta(state);
  return (
    <div className={`cloud-status ${className ?? ""}`.trim()} data-state={state}>
      <Link
        href={href}
        className="cloud-status-link focus-ring"
        aria-label={`Sync status: ${meta.label}. Open connection health settings.`}
      >
        <span className={`status-dot status-dot-${meta.tone}`} aria-hidden />
        <span className="status-label">{meta.label}</span>
      </Link>
    </div>
  );
}
