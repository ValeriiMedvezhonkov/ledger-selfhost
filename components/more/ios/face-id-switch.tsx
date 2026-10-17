"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  disableAppLock,
  getPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
} from "@/app/actions/app-lock";
import { Switch } from "@/components/ios/controls";
import { describeFailure, unwrap } from "@/components/more/ios/passkey";

/**
 * The Face ID row's switch on Ещё. On: register a platform passkey (the
 * device's own Face ID / Touch ID) and the server switches the lock on and
 * counts this session as unlocked. Off: forget every passkey — which the
 * server only allows from an unlocked session.
 *
 * The switch moves at once and snaps back if the ceremony fails, the way a
 * Settings toggle does; the parent keys this component on the server's
 * value, so a refresh after success re-seeds it rather than an effect.
 */
export function FaceIdSwitch({ enabled }: { readonly enabled: boolean }) {
  const t = useTranslations("ios.more.lockSetup");
  const tm = useTranslations("ios.more");
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, setPending] = useState(false);

  const report = (error: unknown) => {
    const failure = describeFailure(error);
    if (failure.kind === "cancelled") toast(t("cancelled"));
    else if (failure.kind === "exists") toast.error(t("exists"));
    else if (failure.kind === "message") toast.error(failure.message);
    else toast.error(t("failed"));
  };

  const turnOn = async () => {
    if (!browserSupportsWebAuthn()) {
      toast.error(t("unsupported"));
      return;
    }
    setOn(true);
    setPending(true);
    try {
      const { options } = unwrap(await getPasskeyRegistrationOptions({}), t("failed"));
      const response = await startRegistration({ optionsJSON: options });
      unwrap(await verifyPasskeyRegistration({ response }), t("failed"));
      toast.success(t("enabled"));
      router.refresh();
    } catch (error) {
      setOn(false);
      report(error);
    } finally {
      setPending(false);
    }
  };

  const turnOff = async () => {
    setOn(false);
    setPending(true);
    try {
      unwrap(await disableAppLock({}), t("failed"));
      toast.success(t("disabled"));
      router.refresh();
    } catch (error) {
      setOn(true);
      report(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Switch
      label={tm("rows.faceId")}
      checked={on}
      disabled={pending}
      onChange={(next) => {
        void (next ? turnOn() : turnOff());
      }}
    />
  );
}
