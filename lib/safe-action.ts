import "server-only";
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { getTranslations } from "next-intl/server";
import {
  NotAuthenticatedError,
  TwoFactorRequiredError,
  requireUserForAction,
  requireUserForFactorAction,
} from "@/lib/auth";
import { getAppLockState } from "@/lib/app-lock";

/**
 * An error meant for the user, carrying a key from the `errors` catalogue
 * rather than a sentence.
 *
 * A key, because the message has to reach the user in their own language and
 * this is the last place that knows it. Translating here rather than at each
 * toast keeps every call site to one line and means a new error is a catalogue
 * entry, not another translation call to remember.
 */
export class ActionError extends Error {
  constructor(key: string) {
    super(key);
    this.name = "ActionError";
  }
}

const base = createSafeActionClient({
  async handleServerError(error) {
    const t = await getTranslations("errors");

    if (
      error instanceof ActionError ||
      error instanceof NotAuthenticatedError ||
      error instanceof TwoFactorRequiredError
    ) {
      // `t.has` guards a key that outlived its message — a stale deployment or
      // a typo should degrade to the generic line, not throw inside the error
      // handler and turn a clear failure into an opaque one.
      return t.has(error.message) ? t(error.message) : t("unexpected");
    }

    // Anything unexpected is logged server-side and generalised for the client,
    // so internals never leak into a toast.
    console.error("[action]", error);
    return t.has("unexpected") ? t("unexpected") : DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

/**
 * Every mutating action uses this client. Auth is resolved here, in the action
 * itself — not inherited from the proxy — and the household id in `ctx` is the
 * only one an action may write to.
 */
/**
 * Unauthenticated actions — the sign-in steps themselves, which by definition
 * run before there is a session.
 */
export const actionClient = base;

export const authAction = base.use(async ({ next }) => {
  const user = await requireUserForAction();

  /*
   * The Face ID lock is enforced here, next to the second factor, for the same
   * reason: this is the one gate every mutation passes. A lock screen drawn by
   * the client alone would stop nobody who posted to an action directly.
   */
  const lock = await getAppLockState();
  if (lock.enabled && lock.locked) throw new ActionError("appLocked");

  return next({ ctx: { user } });
});

/**
 * Signed in and past the second factor, but allowed while the app lock is
 * engaged. Only for the actions that exist to *operate* the lock — presenting
 * a passkey and locking again. Separate by name for the reason given on
 * `factorAction`: an exemption has to be asked for, not passed as a flag.
 */
export const authActionAllowLocked = base.use(async ({ next }) => {
  const user = await requireUserForAction();
  return next({ ctx: { user } });
});

/**
 * For the handful of actions that exist to *satisfy* the second factor.
 *
 * Deliberately a separate client rather than a flag on the one above: an
 * exemption you have to opt into by name is much harder to spread by accident
 * than one you can pass as an option.
 */
export const factorAction = base.use(async ({ next }) => {
  const user = await requireUserForFactorAction();
  return next({ ctx: { user } });
});
