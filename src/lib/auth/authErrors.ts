export type AuthErrorCode = "missing-config" | "not-signed-in" | "interaction-required" | "unknown";

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export const isAuthError = (value: unknown): value is AuthError => value instanceof AuthError;
