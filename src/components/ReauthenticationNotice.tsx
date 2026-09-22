"use client";

import { useAuth } from "@/components/AuthProvider";
import { ProviderSignInButton } from "@/components/ProviderSignInButton";
import type { CloudProviderId } from "@/lib/storage/types";

export function ReauthenticationNotice({
  providerId,
  isOnline,
}: {
  providerId: CloudProviderId;
  isOnline: boolean;
}) {
  const { providers, rememberedProviders, signIn } = useAuth();
  const session = providers[providerId];
  if (!isOnline || !rememberedProviders[providerId] || session.status !== "signed_out") return null;
  const label = providerId === "onedrive" ? "OneDrive" : "Google Drive";
  return (
    <section className="app-alert" aria-label={`Reconnect to ${label}`}>
      <p role="status">
        {session.reauthPrompt === "consent"
          ? `${label} needs your permission to resume syncing.`
          : `You previously used ${label} on this device. Sign in to resume syncing.`}
      </p>
      <ProviderSignInButton
        providerId={providerId}
        disabled={false}
        onSignIn={() => void signIn(providerId)}
      />
      {session.error ? <p role="status">{session.error}</p> : null}
    </section>
  );
}
