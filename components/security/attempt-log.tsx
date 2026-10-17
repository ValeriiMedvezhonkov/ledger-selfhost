import { getTranslations } from "next-intl/server";
import { getFormats } from "@/lib/formats-server";
import type { AttemptRow } from "@/lib/auth-attempts";
import { SectionHeader } from "@/components/ios/list";
import { cn } from "@/lib/utils";

export interface AttemptLogProps {
  readonly attempts: readonly AttemptRow[];
}

/**
 * Every sign-in attempt with the address it came from.
 *
 * Failures are kept rather than cleared on success, so this stays a record
 * instead of a counter — an unfamiliar address is the thing worth seeing.
 *
 * A table did not fit a phone column, so each attempt is a grouped row: what
 * happened and when on the first line, who and from where on the second, and
 * the outcome as a coloured word at the trailing edge.
 */
export async function AttemptLog({ attempts }: AttemptLogProps) {
  const t = await getTranslations("security");
  const f = await getFormats();

  const stageLabel: Record<string, string> = {
    signin: t("stageSignin"),
    totp: t("stageTotp"),
    backup: t("stageBackup"),
    refresh: t("stageRefresh"),
  };
  const outcomeLabel: Record<string, string> = {
    success: t("outcomeSuccess"),
    failure: t("outcomeFailure"),
    locked: t("outcomeLocked"),
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title={t("attemptsTitle")} />
      <p className="t-footnote text-label-2 px-4">{t("attemptsBody")}</p>
      <div className="inset-group">
        {attempts.length === 0 ? (
          <p className="t-subhead text-label-2 px-4 py-4">{t("attemptsEmpty")}</p>
        ) : (
          attempts.map((attempt) => {
            const who = [attempt.email, attempt.ip]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · ");
            return (
              <div key={attempt.id} className="flex items-center pl-4">
                <div className="row-sep flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pr-4">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="t-body truncate">
                      {stageLabel[attempt.stage] ?? attempt.stage}
                    </span>
                    <span className="t-footnote text-label-2 truncate">{who}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span
                      className={cn(
                        "t-subhead font-medium",
                        attempt.outcome === "success" ? "text-ios-green" : "text-ios-red",
                      )}
                    >
                      {outcomeLabel[attempt.outcome] ?? attempt.outcome}
                    </span>
                    <span className="t-footnote text-label-2 money whitespace-nowrap">
                      {f.dateTime(attempt.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
