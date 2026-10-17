"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { signOutUser } from "@/app/actions/sign-out";
import { LOCALE_NAMES, isLocale } from "@/lib/locale";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { ActionRow, ListRow } from "@/components/ios/list";
import { MemberAvatar } from "@/components/ios/controls";
import { Symbol } from "@/components/ios/symbol";
import { IosAlert } from "@/components/ios/alert";
import { FaceIdSwitch } from "@/components/more/ios/face-id-switch";
import { useThemeChoice, useThemeLabel } from "@/components/more/ios/parts";

export interface MoreScreenProps {
  readonly householdName: string;
  readonly baseCurrency: string;
  readonly members: readonly { readonly id: string; readonly name: string; readonly color: string }[];
  readonly counts: {
    readonly goals: number;
    readonly accounts: number;
    readonly categories: number;
    readonly recurring: number;
  };
  readonly walletConfigured: boolean;
  readonly appLockEnabled: boolean;
}

/**
 * Ещё (boards L09 / D09), the fourth tab: the household card on top, then
 * three groups — what the money is organised into, where it comes in from,
 * and how the app behaves — and Выйти on its own at the end.
 *
 * «Пароль и вход» is not on the board. The second factor and the sign-in log
 * used to be reachable from the old Settings page, and a security setting
 * that nobody can find is worse than one extra row.
 */
export function MoreScreen({
  householdName,
  baseCurrency,
  members,
  counts,
  walletConfigured,
  appLockEnabled,
}: MoreScreenProps) {
  const t = useTranslations("ios.more");
  const locale = useLocale();
  const { choice } = useThemeChoice();
  const themeLabel = useThemeLabel();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, startSignOut] = useTransition();

  // «Alex и Sam» — the conjunction in the interface language.
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    members.map((member) => member.name),
  );
  // Names truncate before the currency does: «Alex и S… · EUR».
  // A separator and an ISO code, the same in every language.
  const currency = `\u00a0· ${baseCurrency}`;
  const shown = members.slice(0, 3);

  return (
    <>
      <NavBar large title={t("title")} />

      <ScreenBody className="pt-[18px]">
        <Link
          href="/more/household"
          transitionTypes={["ios-push"]}
          className="inset-group press-row flex items-center gap-3.5 p-4"
        >
          <span className="flex shrink-0">
            {shown.map((member, index) => (
              <span key={member.id} className={index > 0 ? "-ml-3.5" : undefined}>
                <MemberAvatar name={member.name} color={member.color} size={52} ring="var(--ios-card)" />
              </span>
            ))}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[20px] leading-[25px] font-bold tracking-[-0.025em]">
              {householdName}
            </span>
            <span className="text-label-2 flex min-w-0 text-[14px] leading-[18px] tracking-[-0.007em]">
              <span className="truncate">{names}</span>
              <span className="shrink-0">{currency}</span>
            </span>
          </span>
          <Symbol name="chevron_right" size={20} weight={600} className="text-label-3 -mr-1" />
        </Link>

        <div className="inset-group">
          <ListRow
            title={t("rows.goals")}
            tile={{ icon: "flag", color: "var(--ios-green)" }}
            value={String(counts.goals)}
            href="/goals"
          />
          <ListRow
            title={t("rows.accounts")}
            tile={{ icon: "account_balance", color: "var(--ios-blue)" }}
            value={String(counts.accounts)}
            href="/accounts"
          />
          <ListRow
            title={t("rows.categories")}
            tile={{ icon: "category", color: "var(--ios-orange)" }}
            value={String(counts.categories)}
            href="/categories"
          />
          <ListRow
            title={t("rows.recurring")}
            tile={{ icon: "event_repeat", color: "var(--ios-purple)" }}
            value={String(counts.recurring)}
            href="/recurring"
          />
        </div>

        <div className="inset-group">
          <ListRow
            title={t("rows.import")}
            tile={{ icon: "download", color: "var(--ios-teal)" }}
            value={t("importValue")}
            href="/import"
          />
          <ListRow
            title={t("rows.applePay")}
            tile={{ icon: "contactless", color: "#1C1C1E" }}
            value={walletConfigured ? t("connected") : t("notConfigured")}
            href="/more/apple-pay"
          />
        </div>

        <div className="inset-group">
          <ListRow
            title={t("rows.appearance")}
            tile={{ icon: "dark_mode", color: "var(--ios-tint)" }}
            value={choice === null ? "" : themeLabel(choice)}
            href="/more/appearance"
          />
          <ListRow
            title={t("rows.language")}
            tile={{ icon: "translate", color: "var(--ios-blue)" }}
            value={isLocale(locale) ? LOCALE_NAMES[locale] : locale}
            href="/more/language"
          />
          <ListRow
            title={t("rows.faceId")}
            tile={{ icon: "face", color: "var(--ios-green)" }}
            accessory="none"
            trailing={<FaceIdSwitch key={String(appLockEnabled)} enabled={appLockEnabled} />}
          />
          <ListRow
            title={t("rows.security")}
            tile={{ icon: "password", color: "var(--ios-gray)" }}
            href="/settings"
          />
        </div>

        <ActionRow
          destructive
          onClick={() => {
            setConfirmSignOut(true);
          }}
        >
          {t("signOut")}
        </ActionRow>
      </ScreenBody>

      <IosAlert
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t("signOutTitle")}
        message={t("signOutBody")}
        cancelLabel={t("cancel")}
        confirmLabel={t("signOut")}
        pending={signingOut}
        onConfirm={() => {
          startSignOut(async () => {
            await signOutUser();
          });
        }}
      />
    </>
  );
}
