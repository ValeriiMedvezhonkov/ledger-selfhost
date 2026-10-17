/**
 * When repeated failures close the door.
 *
 * A module of plain constants with no imports, so the unlock script can share
 * them with the server code that enforces them. Two copies of these numbers
 * would drift, and the script would then report a lockout state that does not
 * match the one the app is actually applying.
 */
export const MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;
