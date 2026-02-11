export {};

declare global {
  type GoogleTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    error?: string;
    error_description?: string;
  };

  type GoogleTokenClient = {
    callback: (response: GoogleTokenResponse) => void;
    requestAccessToken: (options?: { prompt?: string }) => void;
  };

  type GoogleAccounts = {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (response: GoogleTokenResponse) => void;
      }) => GoogleTokenClient;
      revoke: (token: string, done: () => void) => void;
    };
  };

  interface Window {
    google?: {
      accounts: GoogleAccounts;
    };
  }
}
