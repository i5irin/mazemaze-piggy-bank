import SharedGoalsClient from "@/app/shared/SharedGoalsClient";
import { Suspense } from "react";

export default function SharedGoalsPage() {
  return (
    <Suspense
      fallback={
        <div className="app-muted" role="status" aria-live="polite">
          Loading goals...
        </div>
      }
    >
      <SharedGoalsClient />
    </Suspense>
  );
}
