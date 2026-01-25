"use client";

import { GoalsView } from "@/components/GoalsView";
import { usePersonalData } from "@/components/PersonalDataProvider";

export default function GoalsClient() {
  const data = usePersonalData();
  return <GoalsView data={data} />;
}
