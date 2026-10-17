"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { setDefaultAccount } from "@/app/(app)/accounts/actions";
import { checkWalletConnection, rotateWalletSecret } from "@/app/actions/wallet";
import { addDaysISO, type ISODate } from "@/lib/date";
import type { Minor } from "@/lib/money";
import { categorySymbol } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassPill } from "@/components/ios/glass";
import { ListRow, SectionHeader, SymbolTile } from "@/components/ios/list";
import { GlassMenu } from "@/components/ios/menu";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import { IosAlert } from "@/components/ios/alert";
import { cn } from "@/lib/utils";

export interface LastTap {
  readonly id: string;
  readonly merchant: string | null;
  readonly amountMinor: Minor;
  readonly currency: string;
  readonly occurredOn: ISODate;
  readonly occurredAt: Date | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categorySlug: string | null;
  readonly categoryColor: string | null;
}

export interface ApplePayScreenProps {
  readonly configured: boolean;
  /** The household's own secret, the deployment-wide fallback, or none. */
  readonly secretSource: "db" | "env" | null;
  readonly secretHint: string | null;
  /** The last refusal, only when it is newer than the last recorded tap. */
  readonly lastError: string | null;
  readonly defaultAccountId: string | null;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly lastTap: LastTap | null;
  readonly today: ISODate;
  /** Pre-filled into the Shortcut body example. */
  readonly email: string;
}

interface Failure { error: { serverError?: string | undefined } }

/** A real Slovak terminal name, so the example reads like a real tap. */
const EXAMPLE_MERCHANT = "Slovnaft";

/**
 * Apple Pay (boards EL07 / E07): whether the Wallet webhook can record taps,
 * where they land, the last one that arrived, and the two things the user
 * can do about it — check the connection and reissue the secret.
 *
 * The secret is shown exactly once, in the sheet that follows a rotation;
 * only its hash is stored, so closing the sheet is the last chance to copy it.
 */
export function ApplePayScreen({
  configured,
  secretSource,
  secretHint,
  lastError,
  defaultAccountId,
  accounts,
  lastTap,
  today,
  email,
}: ApplePayScreenProps) {
  const t = useTranslations("ios.more.applePay");
  const tm = useTranslations("ios.more");
  const ti = useTranslations("ios");
  const f = useFormats();
  const router = useRouter();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [issued, setIssued] = useState<{ readonly secret: string; readonly url: string } | null>(null);
  const [issuedOpen, setIssuedOpen] = useState(false);

  const failed = ({ error }: Failure) => {
    toast.error(error.serverError ?? t("failed"));
  };

  const makeDefault = useAction(setDefaultAccount, {
    onSuccess: () => {
      toast.success(t("defaultSaved"));
      router.refresh();
    },
    onError: failed,
  });

  const check = useAction(checkWalletConnection, {
    onSuccess: ({ data }) => {
      const { checks } = data;
      const lastTapLine =
        checks.lastTapAgeHours === null
          ? t("checkNoTaps")
          : t("checkLastTap", { hours: checks.lastTapAgeHours });
      if (data.ok) {
        toast.success(t("checkOk"), { description: lastTapLine });
        return;
      }
      const problems = [
        checks.secret ? null : t("checkNoSecret"),
        checks.defaultAccount ? null : t("checkNoAccount"),
        checks.members ? null : t("checkNoMembers"),
      ].filter((line): line is string => line !== null);
      toast.error(t("checkFailed"), { description: problems.join(" ") });
    },
    onError: failed,
  });

  const rotate = useAction(rotateWalletSecret, {
    onSuccess: ({ data }) => {
      setConfirmRotate(false);
      setIssued({ secret: data.secret, url: `${window.location.origin}/api/webhooks/wallet` });
      setIssuedOpen(true);
      router.refresh();
    },
    onError: (failure: Failure) => {
      setConfirmRotate(false);
      failed(failure);
    },
  });

  const defaultName = accounts.find((a) => a.id === defaultAccountId)?.name ?? t("noAccount");

  // «вчера, 12:40»: the day relative to the server's today, then the clock
  // time the tap carried.
  const tapWhen = (() => {
    if (lastTap === null) return "";
    const day =
      lastTap.occurredOn === today
        ? ti("today")
        : lastTap.occurredOn === addDaysISO(today, -1)
          ? ti("yesterday")
          : f.dateShort(lastTap.occurredOn);
    if (lastTap.occurredAt === null) return day;
    const time = new Intl.DateTimeFormat(f.calendar.code, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(lastTap.occurredAt),
    );
    return t("dayTime", { day: day.toLocaleLowerCase(), time });
  })();

  const statusHint =
    secretSource === "env" ? t("viaEnv") : secretHint !== null ? t("hint", { hint: secretHint }) : null;

  return (
    <>
      <NavBar title={tm("rows.applePay")} back={{ href: "/more", label: tm("title") }} />

      <ScreenBody className="gap-5 pt-2">
        <section className="inset-group flex items-center gap-3.5 p-4">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-black text-white shadow-[inset_0_0_0_0.5px_var(--ios-sep)]"
          >
            <Symbol name="contactless" size={26} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="t-footnote text-label-2">{t("status")}</span>
            <span className="flex items-center gap-[7px]">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", configured ? "bg-ios-green" : "bg-ios-gray")}
              />
              <span className="t-headline truncate">{configured ? tm("connected") : tm("notConfigured")}</span>
            </span>
            {statusHint !== null && <span className="t-footnote text-label-2 truncate">{statusHint}</span>}
            {lastError !== null && (
              <span className="t-footnote text-ios-red line-clamp-2">{t("lastError", { error: lastError })}</span>
            )}
          </span>
        </section>

        <section className="inset-group flex flex-col gap-1 px-4 py-3.5">
          <span className="t-footnote text-label-2">{t("howTitle")}</span>
          <p className="t-body leading-[1.3]">{t("howBody")}</p>
        </section>

        <div className="inset-group">
          <GlassMenu
            label={t("defaultAccount")}
            align="end"
            trigger={
              <button
                type="button"
                className="press-row flex h-[60px] w-full items-center gap-3.5 pl-4 text-left"
                disabled={accounts.length === 0 || makeDefault.isPending}
              >
                <SymbolTile icon="account_balance" color="var(--ios-blue)" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="t-footnote text-label-2 truncate">{t("defaultAccount")}</span>
                  <span className="t-body truncate">{defaultName}</span>
                </span>
                <Symbol name="chevron_right" size={20} weight={600} className="text-label-3 mr-3" />
              </button>
            }
            entries={accounts.map((account) => ({
              key: account.id,
              label: account.name,
              checked: account.id === defaultAccountId,
              onSelect: () => {
                if (account.id !== defaultAccountId) makeDefault.execute({ id: account.id });
              },
            }))}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionHeader title={t("lastTap")} />
          <div className="inset-group">
            {lastTap === null ? (
              <p className="t-subhead text-label-2 px-4 py-4">{t("noTaps")}</p>
            ) : (
              <Link
                href={`/transactions/${lastTap.id}`}
                transitionTypes={["ios-push"]}
                className="press-row flex items-center gap-3 px-4 py-3"
              >
                <SymbolTile
                  icon={categorySymbol(lastTap.categoryIcon, lastTap.categorySlug)}
                  color={lastTap.categoryColor ?? "var(--ios-gray)"}
                  size={40}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="t-headline truncate">{lastTap.merchant ?? t("unknownMerchant")}</span>
                  <span className="text-label-2 text-[13px] leading-[1.3]">
                    <span className="block truncate">{tapWhen}</span>
                    <span className="block truncate">
                      {lastTap.categoryName === null
                        ? t("notMatched")
                        : t("matchedAs", { category: lastTap.categoryName })}
                    </span>
                  </span>
                </span>
                <span className="money t-headline shrink-0 whitespace-nowrap">
                  {minus(f.money(lastTap.amountMinor, lastTap.currency, { signed: true }))}
                </span>
              </Link>
            )}
          </div>
        </div>

        <div className="inset-group">
          <ListRow
            title={t("check")}
            tile={{ icon: "network_check", color: "var(--ios-green)" }}
            accessory="none"
            disabled={check.isPending}
            onClick={() => {
              check.execute({});
            }}
          />
          <ListRow
            title={t("rotate")}
            tile={{ icon: "key", color: "var(--ios-orange)" }}
            accessory="none"
            onClick={() => {
              setConfirmRotate(true);
            }}
          />
        </div>
      </ScreenBody>

      <IosAlert
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={t("rotateTitle")}
        message={configured ? t("rotateBody") : t("rotateBodyFirst")}
        cancelLabel={tm("cancel")}
        confirmLabel={t("rotateConfirm")}
        destructive={configured}
        pending={rotate.isPending}
        onConfirm={() => {
          rotate.execute({});
        }}
      />

      <Sheet
        open={issuedOpen}
        onOpenChange={setIssuedOpen}
        detent="large"
        title={t("secretTitle")}
        onClosed={() => {
          // Gone from memory as soon as the sheet is: it is never shown twice.
          setIssued(null);
        }}
      >
        {issued !== null && (
          <SecretSheet
            secret={issued.secret}
            url={issued.url}
            email={email}
            account={defaultName}
            onClose={() => {
              setIssuedOpen(false);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------- the new secret */

function SecretSheet({
  secret,
  url,
  email,
  account,
  onClose,
}: {
  readonly secret: string;
  readonly url: string;
  readonly email: string;
  readonly account: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations("ios.more.applePay");
  const header = `Authorization: Bearer ${secret}`;
  const body = JSON.stringify(
    { email, amount: t("exampleAmount"), merchant: EXAMPLE_MERCHANT, account },
    null,
    2,
  );

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => {
        toast.success(t("copied"));
      },
      () => {
        toast.error(t("copyFailed"));
      },
    );
  };

  return (
    <>
      <SheetHeader
        title={t("secretTitle")}
        onClose={onClose}
        trailing={
          <GlassPill tinted onClick={onClose}>
            {t("done")}
          </GlassPill>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-10 overscroll-contain *:shrink-0">
        <p className="t-subhead text-label-2 px-1">{t("secretOnce")}</p>

        <CopyBlock label={t("secretLabel")} value={secret} onCopy={copy} copyLabel={t("copy")} prominent />
        <CopyBlock label={t("urlLabel")} value={url} onCopy={copy} copyLabel={t("copy")} />
        <CopyBlock label={t("headerLabel")} value={header} onCopy={copy} copyLabel={t("copy")} />
        <CopyBlock label={t("bodyLabel")} value={body} onCopy={copy} copyLabel={t("copy")} multiline />

        <p className="t-footnote text-label-2 px-1">{t("bodyHint")}</p>
      </div>
    </>
  );
}

function CopyBlock({
  label,
  value,
  onCopy,
  copyLabel,
  prominent = false,
  multiline = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCopy: (value: string) => void;
  readonly copyLabel: string;
  readonly prominent?: boolean;
  readonly multiline?: boolean;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="t-footnote text-label-2 px-1 font-semibold">{label}</h3>
      <div className="inset-group flex items-start gap-2 py-3 pr-2 pl-4">
        <code
          className={cn(
            "min-w-0 flex-1 font-mono text-[14px] leading-[1.45] break-all select-all",
            multiline && "whitespace-pre-wrap",
            prominent && "text-[15px] font-semibold",
          )}
        >
          {value}
        </code>
        <button
          type="button"
          aria-label={`${copyLabel}: ${label}`}
          onClick={() => {
            onCopy(value);
          }}
          className="press text-tint grid size-9 shrink-0 place-items-center rounded-full"
        >
          <Symbol name="content_copy" size={20} />
        </button>
      </div>
    </section>
  );
}
