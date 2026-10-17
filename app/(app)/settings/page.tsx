import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { twoFactorState } from "@/lib/two-factor";
import { listRecentAttempts } from "@/lib/auth-attempts";
import type { SymbolName } from "@/lib/symbols";
import { Screen, ScreenBody } from "@/components/ios/screen";
import { NavBar } from "@/components/ios/nav-bar";
import { InsetGroup, SectionHeader, SymbolTile } from "@/components/ios/list";
import { Symbol } from "@/components/ios/symbol";
import { SecurityPanel } from "@/components/security/security-panel";
import { AttemptLog } from "@/components/security/attempt-log";

export async function generateMetadata(): Promise<Metadata> {
  const tm = await getTranslations("ios.more.security");
  return { title: tm("title") };
}

/**
 * Ещё › Пароль и вход: the second factor, the sign-in log, and the data
 * exports. Not drawn on the iOS 27 boards; it keeps the old Settings
 * behaviour in the new grouped look. Profile, household, theme and language
 * moved to their own screens under Ещё (Семья, Внешний вид, Язык).
 *
 * The exports live here because they are the other "who can get at our data"
 * question, and the Ещё board has no row for them.
 */
export default async function SettingsPage() {
  const [user, t, ts] = await Promise.all([
    requireUser(),
    getTranslations("ios.more"),
    getTranslations("settings"),
  ]);

  const [factor, attempts] = await Promise.all([
    twoFactorState(user.id),
    listRecentAttempts(25),
  ]);

  return (
    <Screen>
      <NavBar title={t("security.title")} back={{ href: "/more", label: t("title") }} />
      <ScreenBody className="gap-[22px] pt-2">
        <SecurityPanel enabled={factor.enabled} backupCodesLeft={factor.backupCodesLeft} />

        <AttemptLog attempts={attempts} />

        <section className="flex flex-col gap-2">
          <SectionHeader title={t("security.data")} />
          <InsetGroup footer={t("security.dataFootnote")}>
            {/*
              Plain downloads: the routes stream the file and the browser saves
              it. No fetch, no state — a link that looks like a row.
            */}
            <DownloadRow
              href="/api/export/transactions.csv"
              icon="description"
              color="var(--ios-teal)"
              label={ts("exportCsv")}
            />
            <DownloadRow
              href="/api/export/household.json"
              icon="download"
              color="var(--ios-blue)"
              label={ts("exportAll")}
            />
          </InsetGroup>
        </section>
      </ScreenBody>
    </Screen>
  );
}

function DownloadRow({
  href,
  icon,
  color,
  label,
}: {
  readonly href: string;
  readonly icon: SymbolName;
  readonly color: string;
  readonly label: string;
}) {
  return (
    <a href={href} download className="press-row flex w-full items-center gap-3.5 pl-4">
      <SymbolTile icon={icon} color={color} />
      <span className="row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-1.5 self-stretch py-2 pr-4">
        <span className="t-body min-w-0 flex-1 truncate">{label}</span>
        <Symbol name="download" size={20} weight={600} className="text-label-3" />
      </span>
    </a>
  );
}
