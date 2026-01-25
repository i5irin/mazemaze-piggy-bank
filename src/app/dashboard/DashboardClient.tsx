"use client";

import { DashboardView } from "@/components/DashboardView";
import { usePersonalData } from "@/components/PersonalDataProvider";

export default function DashboardClient() {
  const data = usePersonalData();
  return <DashboardView data={data} />;
}
