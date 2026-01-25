import type { ReactNode } from "react";
import { SharedDataProvider } from "@/components/SharedDataProvider";
import { SharedShell } from "@/components/SharedShell";

export default async function SharedLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ sharedId: string }>;
}) {
  const resolvedParams = await params;
  return (
    <SharedDataProvider sharedId={resolvedParams.sharedId}>
      <SharedShell>{children}</SharedShell>
    </SharedDataProvider>
  );
}
