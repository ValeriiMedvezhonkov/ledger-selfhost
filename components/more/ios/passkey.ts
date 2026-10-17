"use client";

/**
 * Shared plumbing for the two passkey ceremonies the client runs — turning
 * the Face ID lock on (components/more/ios/face-id-switch.tsx) and unlocking
 * (components/more/ios/app-lock-gate.tsx).
 *
 * Both chain three calls (server options → the browser's Face ID sheet →
 * server verification), so they call the safe actions directly and await
 * each result instead of juggling three useAction hooks; this turns a failed
 * step into a thrown error that one catch can report.
 */

/** A failure whose message is already fit for a toast (server-translated). */
export class PasskeyStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyStepError";
  }
}

interface ActionResultLike<T> {
  readonly data?: T | undefined;
  readonly serverError?: string | undefined;
}

/** The action's data, or a PasskeyStepError carrying its translated error. */
export function unwrap<T>(
  result: ActionResultLike<T> | undefined,
  fallback: string,
): T {
  if (result?.data === undefined) {
    throw new PasskeyStepError(result?.serverError ?? fallback);
  }
  return result.data;
}

export type PasskeyFailure =
  | { readonly kind: "cancelled" }
  | { readonly kind: "exists" }
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "failed" };

/**
 * What went wrong, in terms the toast can phrase. @simplewebauthn/browser
 * keeps the DOMException's name on its WebAuthnError: NotAllowedError is the
 * user dismissing the Face ID sheet (or it timing out) — not worth an error
 * tone — and InvalidStateError on registration means this device already
 * holds a passkey for the account.
 */
export function describeFailure(error: unknown): PasskeyFailure {
  if (error instanceof PasskeyStepError) return { kind: "message", message: error.message };
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      return { kind: "cancelled" };
    }
    if (error.name === "InvalidStateError") return { kind: "exists" };
  }
  return { kind: "failed" };
}
