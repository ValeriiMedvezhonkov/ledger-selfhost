"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import { getUnlockOptions, lockApp, verifyUnlock } from "@/app/actions/app-lock";
import { signOutUser } from "@/app/actions/sign-out";
import { ProminentButton } from "@/components/ios/glass";
import { Symbol } from "@/components/ios/symbol";
import { describeFailure, unwrap } from "@/components/more/ios/passkey";
import { AppIcon } from "@/components/more/ios/parts";

/**
 * Set once per browser session (a tab, or one launch of the home-screen
 * app): its absence is what "cold start" means here. iOS drops a standalone
 * app's sessionStorage when the app is killed, so reopening it from the
 * home screen locks, while moving between screens does not.
 */
const SESSION_FLAG = "ledger-app-lock-seen";

/** Away longer than this and the app locks on return, as banking apps do. */
const IDLE_LOCK_MS = 5 * 60 * 1000;

const noSubscribe = () => () => undefined;

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) !== null;
  } catch {
    // Storage blocked (private mode quirks): treat every load as warm rather
    // than locking on each navigation.
    return true;
  }
}

function writeFlag(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // See readFlag.
  }
}

/**
 * The Face ID lock screen, and the client half of *when* to lock.
 *
 * The server decides whether this session is locked (`session.app_unlocked_at`,
 * see lib/app-lock.ts) and refuses every mutation while it is. The client
 * only knows when the user has *left*: a cold start, or coming back after
 * five minutes away. Then it calls `lockApp` and refreshes, and the server
 * answers with `locked` — so the lock screen is always the server's verdict,
 * never a client flag someone could flip.
 *
 * On a cold start the server still believes the session is unlocked for the
 * one round trip it takes to lock it. Rather than flash the household's
 * numbers in that gap, the same screen covers everything (without the
 * button) until the client has checked the session flag.
 */
export function AppLockGate({
  enabled,
  locked,
}: {
  readonly enabled: boolean;
  readonly locked: boolean;
}) {
  const t = useTranslations("ios.more.lock");
  const router = useRouter();
  const [unlocking, setUnlocking] = useState(false);
  const [signingOut, startSignOut] = useTransition();

  // False on the server and during hydration, so the first paint of an
  // enabled-but-unlocked session is covered until the flag has been read.
  const warm = useSyncExternalStore(noSubscribe, readFlag, () => false);

  useEffect(() => {
    if (!enabled) {
      writeFlag();
      return;
    }

    const lock = async () => {
      try {
        await lockApp({});
      } finally {
        router.refresh();
      }
    };

    if (!readFlag()) {
      writeFlag();
      if (!locked) void lock();
    }

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > IDLE_LOCK_MS && !locked) void lock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, locked, router]);

  const unlock = async () => {
    setUnlocking(true);
    try {
      const { options } = unwrap(await getUnlockOptions({}), t("failed"));
      const response = await startAuthentication({ optionsJSON: options });
      unwrap(await verifyUnlock({ response }), t("failed"));
      router.refresh();
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind === "message") toast.error(failure.message);
      else if (failure.kind !== "cancelled") toast.error(t("failed"));
    } finally {
      setUnlocking(false);
    }
  };

  if (!enabled) return null;
  const covering = !locked && !warm;
  if (!locked && !covering) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-lock-title"
      className="aurora-root fixed-fill z-[200] flex justify-center overflow-hidden"
      style={{
        background: [
          "radial-gradient(62% 38% at 12% 12%, rgb(125 122 255 / 0.85), transparent 70%)",
          "radial-gradient(55% 38% at 92% 26%, rgb(255 94 130 / 0.8), transparent 70%)",
          "radial-gradient(62% 34% at 48% 56%, rgb(48 205 215 / 0.75), transparent 72%)",
          "radial-gradient(48% 34% at 0% 92%, rgb(255 160 80 / 0.7), transparent 70%)",
          "radial-gradient(56% 40% at 100% 92%, rgb(140 130 255 / 0.65), transparent 70%)",
          "var(--aurora-bg)",
        ].join(", "),
      }}
    >
      <div className="relative flex h-full w-full max-w-[440px] flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-10 text-center">
          <AppIcon size={104} />
          <h1 id="app-lock-title" className="t-title1">
            {t("title")}
          </h1>
          <p className="t-callout text-label-2 max-w-[280px]">{t("body")}</p>
        </div>

        <div
          className="glass glass-strong mx-3 flex flex-col items-center gap-4 rounded-[40px] px-5 pt-5 pb-4"
          style={{ marginBottom: "max(12px, var(--safe-bottom))" }}
        >
          {locked ? (
            <>
              <ProminentButton
                pending={unlocking}
                disabled={unlocking}
                onClick={() => {
                  void unlock();
                }}
                className="gap-2"
              >
                <Symbol name="face" size={24} weight={600} />
                {t("unlock")}
              </ProminentButton>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => {
                  startSignOut(async () => {
                    await signOutUser();
                  });
                }}
                className="t-subhead text-tint press px-3 py-1 disabled:opacity-50"
              >
                {t("signOut")}
              </button>
            </>
          ) : (
            <p className="t-subhead text-label-2 py-3">{t("checking")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
