"use client";

import { AccountsView } from "@/components/AccountsView";
import { usePersonalData } from "@/components/PersonalDataProvider";

export default function AccountsClient() {
  const data = usePersonalData();
  return <AccountsView data={data} />;
}
