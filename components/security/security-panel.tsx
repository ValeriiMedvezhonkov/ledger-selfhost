"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  confirmEnrolment,
  newBackupCodes,
  startEnrolment,
  turnOffTwoFactor,
} from "@/app/(app)/settings/security-actions";
import { InsetGroup, ListRow } from "@/components/ios/list";
import { ProminentButton } from "@/components/ios/glass";
import { Symbol } from "@/components/ios/symbol";

export interface SecurityPanelProps {
  readonly enabled: boolean;
  readonly backupCodesLeft: number;
}

interface Failure { error: { serverError?: string | undefined } }

/**
 * Two-step sign-in, drawn as iOS inset groups (Ещё › Пароль и вход).
 *
 * The flow is unchanged from the card it replaced: start → scan the QR (or
 * type the key) → confirm a code → see the backup codes once. Turning it off
 * and reissuing backup codes both demand a current code, so a borrowed,
 * unlocked phone is not enough to weaken the account.
 */
export function SecurityPanel({ enabled, backupCodesLeft }: SecurityPanelProps) {
  const t = useTranslations("security");
  const router = useRouter();

  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [code, setCode] = useState("");

  const failed = ({ error }: Failure) => {
    toast.error(error.serverError ?? "");
  };

  const begin = useAction(startEnrolment, {
    onSuccess({ data }) {
      setQr(data.qr);
      setSecret(data.secret);
    },
    onError: failed,
  });

  const confirm = useAction(confirmEnrolment, {
    onSuccess({ data }) {
      setQr(null);
      setSecret(null);
      setCode("");
      setCodes(data.codes);
      toast.success(t("enabledToast"));
      router.refresh();
    },
    onError: failed,
  });

  const regenerate = useAction(newBackupCodes, {
    onSuccess({ data }) {
      setCode("");
      setCodes(data.codes);
      router.refresh();
    },
    onError: failed,
  });

  const turnOff = useAction(turnOffTwoFactor, {
    onSuccess() {
      setCode("");
      setCodes(null);
      toast.success(t("disabledToast"));
      router.refresh();
    },
    onError: failed,
  });

  const busy = regenerate.isPending || turnOff.isPending;

  return (
    <>
      <InsetGroup footer={t("twoFactorBody")}>
        <ListRow
          title={t("twoFactor")}
          tile={{
            icon: enabled ? "verified_user" : "shield",
            color: enabled ? "var(--ios-green)" : "var(--ios-gray)",
          }}
          subtitle={enabled ? t("twoFactorOn") : t("twoFactorOff")}
          accessory="none"
        />
        {!enabled && qr === null && (
          <ListRow
            title={t("enable")}
            tinted
            accessory="none"
            disabled={begin.isPending}
            onClick={() => {
              begin.execute({});
            }}
          />
        )}
      </InsetGroup>

      {codes !== null && <BackupCodeList codes={codes} />}

      {!enabled && qr !== null && secret !== null && (
        <section className="inset-group flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-0.5">
            <p className="t-headline">{t("scanTitle")}</p>
            <p className="t-footnote text-label-2">{t("scanBody")}</p>
          </div>
          {/* Data URI produced server-side, so nothing external is fetched. */}
          <Image
            src={qr}
            alt={t("scanTitle")}
            width={200}
            height={200}
            unoptimized
            className="self-center rounded-[18px] bg-white p-2"
          />
          <label className="flex flex-col gap-1.5">
            <span className="t-footnote text-label-2 font-semibold">{t("manualEntry")}</span>
            <input
              readOnly
              value={secret}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="bg-ios-fill-3 h-[46px] rounded-full px-4 font-mono text-[13px] outline-none"
            />
          </label>
          <CodeField
            label={t("confirmPrompt")}
            value={code}
            onChange={setCode}
            disabled={confirm.isPending}
          />
          {confirm.result.serverError !== undefined && (
            <p role="alert" className="t-footnote text-ios-red">
              {confirm.result.serverError}
            </p>
          )}
          <ProminentButton
            pending={confirm.isPending}
            disabled={confirm.isPending}
            onClick={() => {
              confirm.execute({ code });
            }}
          >
            {t("confirmAction")}
          </ProminentButton>
        </section>
      )}

      {enabled && (
        <InsetGroup footer={t("backupRemaining", { count: backupCodesLeft })}>
          <div className="row-sep px-4 py-3">
            <CodeField label={t("codeLabel")} value={code} onChange={setCode} disabled={busy} />
          </div>
          <ListRow
            title={t("backupRegenerate")}
            tile={{ icon: "restart_alt", color: "var(--ios-blue)" }}
            accessory="none"
            disabled={busy}
            onClick={() => {
              regenerate.execute({ code });
            }}
          />
          <ListRow
            title={t("disable")}
            tile={{ icon: "no_encryption", color: "var(--ios-red)" }}
            destructive
            accessory="none"
            disabled={busy}
            onClick={() => {
              turnOff.execute({ code });
            }}
          />
        </InsetGroup>
      )}
    </>
  );
}

function CodeField({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="t-footnote text-label-2 font-semibold">{label}</span>
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={32}
        disabled={disabled}
        className="bg-ios-fill-3 money placeholder:text-label-3 h-[46px] w-full rounded-full px-4 text-[20px] tracking-[0.3em] outline-none disabled:opacity-50"
      />
    </label>
  );
}

function BackupCodeList({ codes }: { readonly codes: readonly string[] }) {
  const t = useTranslations("security");

  return (
    <section className="inset-group flex flex-col gap-2 p-4">
      <p className="t-headline flex items-center gap-2">
        <Symbol name="key" size={20} className="text-ios-orange" />
        {t("backupTitle")}
      </p>
      <p className="t-footnote text-label-2">{t("backupBody")}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 font-mono text-[15px] select-all">
        {codes.map((entry) => (
          <span key={entry}>{entry}</span>
        ))}
      </div>
    </section>
  );
}
