/**
 * The one sanctioned place a wall-clock read may happen.
 *
 * `no-restricted-syntax` bans `new Date()` inside server components so that
 * rendering stays deterministic and time enters a component tree through an
 * explicit argument. Pages still need to know what "today" is, so they call
 * this once at the top and thread the value down.
 */
export function serverNow(): Date {
  return new Date();
}
