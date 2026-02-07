import GoalsClient from "./GoalsClient";
import { Suspense } from "react";

export const metadata = {
  title: "Goals",
};

export default function GoalsPage() {
  return (
    <Suspense
      fallback={
        <div className="app-muted" role="status" aria-live="polite">
          Loading goals...
        </div>
      }
    >
      <GoalsClient />
    </Suspense>
  );
}
