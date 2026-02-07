import AccountsClient from "./AccountsClient";
import { Suspense } from "react";

export const metadata = {
  title: "Accounts",
};

export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="app-muted" role="status" aria-live="polite">
          Loading accounts...
        </div>
      }
    >
      <AccountsClient />
    </Suspense>
  );
}
