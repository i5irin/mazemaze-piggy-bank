import { redirect } from "next/navigation";

export default function SharedRootPage({ params }: { params: { sharedId: string } }) {
  redirect(`/shared/${encodeURIComponent(params.sharedId)}/dashboard`);
}
