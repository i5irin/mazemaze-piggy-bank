"use client";

import { GoalsView } from "@/components/GoalsView";
import { useSharedData } from "@/components/SharedDataProvider";

export default function SharedGoalsClient() {
  const data = useSharedData();
  return <GoalsView data={data} />;
}
