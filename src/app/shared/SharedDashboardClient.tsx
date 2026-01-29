"use client";

import { DashboardView } from "@/components/DashboardView";
import { useSharedData } from "@/components/SharedDataProvider";

export default function SharedDashboardClient() {
  const data = useSharedData();
  return <DashboardView data={data} />;
}
