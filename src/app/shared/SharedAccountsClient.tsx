"use client";

import { AccountsView } from "@/components/AccountsView";
import { useSharedData } from "@/components/SharedDataProvider";

export default function SharedAccountsClient() {
  const data = useSharedData();
  return <AccountsView data={data} />;
}
