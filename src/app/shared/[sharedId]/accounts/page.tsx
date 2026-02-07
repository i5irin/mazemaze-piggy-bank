import SharedAccountsClient from "@/app/shared/SharedAccountsClient";
import { Suspense } from "react";

export default function SharedAccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="app-muted" role="status" aria-live="polite">
          Loading accounts...
        </div>
      }
    >
      <SharedAccountsClient />
    </Suspense>
  );
}
