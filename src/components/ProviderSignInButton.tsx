"use client";

import type { CloudProviderId } from "@/lib/storage/types";

const PROVIDER_SIGNIN_LABELS = {
  onedrive: "Sign in with Microsoft",
  gdrive: "Sign in with Google",
};

export function ProviderSignInButton({
  providerId,
  disabled,
  onSignIn,
}: {
  providerId: CloudProviderId;
  disabled: boolean;
  onSignIn: () => void;
}) {
  return (
    <button
      type="button"
      className={`provider-signin-button provider-signin-button-${providerId}`}
      onClick={() => void onSignIn()}
      disabled={disabled}
      aria-label={PROVIDER_SIGNIN_LABELS[providerId]}
    >
      <span className="provider-signin-logo" aria-hidden>
        {providerId === "onedrive" ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
            <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
          </svg>
        ) : (
          <svg viewBox="0 0 18 18" aria-hidden>
            <path
              fill="#4285F4"
              d="M17.64 9.2045c0-.638-.0573-1.251-.1636-1.836H9v3.476h4.8445c-.2082 1.121-.8364 2.071-1.7764 2.709v2.25h2.8845c1.689-1.554 2.688-3.846 2.688-6.282z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.806 5.96-2.188l-2.8845-2.25c-.806.54-1.836.86-3.076.86-2.364 0-4.364-1.596-5.086-3.74H0.93v2.332C2.412 15.978 5.47 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.914 10.682c-.18-.54-.283-1.116-.283-1.682s.103-1.142.283-1.682V4.986H0.93C.332 6.186 0 7.54 0 9s.332 2.814.93 4.014l2.984-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.508.454 3.44 1.346l2.58-2.58C13.46.89 11.43 0 9 0 5.47 0 2.412 2.022.93 4.986l2.984 2.332C4.636 5.176 6.636 3.58 9 3.58z"
            />
          </svg>
        )}
      </span>
      <span className="provider-signin-text">{PROVIDER_SIGNIN_LABELS[providerId]}</span>
    </button>
  );
}
