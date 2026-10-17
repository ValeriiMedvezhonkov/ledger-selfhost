/**
 * How long a session lives without use.
 *
 * Shared by auth.ts, which sets it on the session row, and proxy.ts, which
 * slides the cookie by the same amount. Two copies of this number would drift,
 * and the failure would be quiet: a cookie shorter than the session logs people
 * out early, a cookie longer than it leaves a dead token on disk.
 *
 * Deliberately a module of plain constants with no imports, so the proxy can
 * use it without pulling the database and auth stack into its bundle.
 */
/*
 * Short, because a refresh token renews it silently. This is the credential
 * sent on every request, so it is the one worth keeping shortest — a copy of it
 * stops working within the week rather than within the month.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * The renewal credential. Long, but rotated on every use and revocable as a
 * family, so a stolen one is both detectable and containable.
 */
export const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/** The cookie holding it. Sent only to the endpoint that consumes it. */
export const REFRESH_COOKIE = "ledger-refresh";
export const REFRESH_COOKIE_SECURE = "__Host-ledger-refresh";

/** How often the session row's expiry is pushed forward, at most. */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
