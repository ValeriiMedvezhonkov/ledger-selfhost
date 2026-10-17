"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import type { AccountWithBalance } from "@/lib/queries";
import type { AccountType } from "@/db/schema";
import { sumMinor, type Minor } from "@/lib/money";
import { accountFormSchema, accountTypes } from "@/lib/validations";
import type { SymbolName } from "@/lib/symbols";
import { minus } from "@/lib/typography";
import { useFormats } from "@/hooks/use-formats";
import {
  archiveAccount,
  createAccount,
  restoreAccount,
  setDefaultAccount,
  updateAccount,
} from "@/app/(app)/accounts/actions";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassButton } from "@/components/ios/glass";
import { ActionRow, SectionHeader, SymbolTile } from "@/components/ios/list";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { IosAlert } from "@/components/ios/alert";
import { Symbol } from "@/components/ios/symbol";
import {
  AmountField,
  CurrencyRow,
  FieldRow,
  MenuRow,
  RowInput,
  useMoneyInput,
} from "@/components/goals/ios/sheet-fields";
import { cn } from "@/lib/utils";

/**
 * The tile each account type wears (board EL03). By type, not per account:
 * a household's three accounts do not need an icon picker.
 */
const TYPE_LOOK: Readonly<Record<AccountType, { readonly icon: SymbolName; readonly color: string }>> = {
  checking: { icon: "credit_card", color: "var(--ios-blue)" },
  savings: { icon: "savings", color: "var(--ios-green)" },
  cash: { icon: "payments", color: "var(--ios-orange)" },
  credit: { icon: "credit_card", color: "var(--ios-red)" },
  investment: { icon: "trending_up", color: "var(--ios-purple)" },
};

const ARCHIVED_LOOK = { icon: "credit_card_off", color: "var(--ios-gray)" } as const;

/** ICU select keys for «Закрыт в {month}» — Russian needs the prepositional case. */
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

interface AccountDraft {
  readonly account: AccountWithBalance | null;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly openingBalance: string;
}

interface Failure {
  readonly error: { readonly serverError?: string | undefined };
}

/**
 * Счета (boards EL03 / E03). The total of the active base-currency accounts
 * as a caption, the active accounts in one inset group with the default one
 * marked «Основной», a full-width «Добавить счёт», and the archive greyed
 * under its own heading. Tapping any account opens its edit sheet, which also
 * carries «Сделать основным» and archive / restore.
 */
export function AccountsScreen({
  accounts,
  baseCurrency,
  currentYear,
}: {
  readonly accounts: readonly AccountWithBalance[];
  readonly baseCurrency: string;
  readonly currentYear: number;
}) {
  const t = useTranslations("ios.accounts");
  const tv = useTranslations("validation");
  const f = useFormats();
  const router = useRouter();
  const toInput = useMoneyInput();

  // The draft outlives the open flag so the sheet keeps its content while it
  // animates away.
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const failed = ({ error }: Failure) => {
    toast.error(error.serverError ?? t("failed"));
  };
  const finish = (message: string) => {
    toast.success(message);
    setConfirmArchive(false);
    setEditing(false);
    router.refresh();
  };
  const create = useAction(createAccount, { onSuccess: () => { finish(t("added")); }, onError: failed });
  const update = useAction(updateAccount, { onSuccess: () => { finish(t("updated")); }, onError: failed });
  const restore = useAction(restoreAccount, { onSuccess: () => { finish(t("restored")); }, onError: failed });
  const makeDefault = useAction(setDefaultAccount, {
    onSuccess: () => { finish(t("madeDefault")); },
    onError: failed,
  });
  const archive = useAction(archiveAccount, {
    // An account nothing was ever recorded on is deleted outright, not archived.
    onSuccess: ({ data }) => { finish(data.archived ? t("archived") : t("deleted")); },
    onError: failed,
  });

  const active = accounts.filter((a) => a.archivedAt === null);
  const archived = accounts.filter((a) => a.archivedAt !== null);
  /*
   * Only base-currency accounts are summed: the list carries no FX conversion,
   * and a total that silently adds koruny to euros is a number nobody holds.
   */
  const total = sumMinor(active.filter((a) => a.currency === baseCurrency).map((a) => a.balanceMinor));
  const money = (minor: Minor, currency: string) => minus(f.money(minor, currency));

  const closedLabel = (at: Date) => {
    const month = MONTH_KEYS[at.getMonth()] ?? "other";
    return at.getFullYear() === currentYear
      ? t("closedIn", { month })
      : t("closedInYear", { month, year: String(at.getFullYear()) });
  };

  const openEditor = (account: AccountWithBalance | null) => {
    setDraft(
      account === null
        ? { account: null, name: "", type: "checking", currency: baseCurrency, openingBalance: "0" }
        : {
            account,
            name: account.name,
            type: account.type,
            currency: account.currency,
            openingBalance: toInput(account.openingBalanceMinor, account.currency),
          },
    );
    setEditing(true);
  };

  const save = () => {
    if (draft === null) return;
    const parsed = accountFormSchema.safeParse({
      name: draft.name,
      type: draft.type,
      currency: draft.currency,
      openingBalance: draft.openingBalance,
    });
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? "";
      toast.error(tv.has(code) ? tv(code) : t("failed"));
      return;
    }
    if (draft.account === null) create.execute(parsed.data);
    else update.execute({ ...parsed.data, id: draft.account.id });
  };

  const row = (account: AccountWithBalance) => {
    const closed = account.archivedAt !== null;
    const look = closed ? ARCHIVED_LOOK : TYPE_LOOK[account.type];
    const parts: string[] = [];
    if (account.archivedAt !== null) parts.push(closedLabel(account.archivedAt));
    else if (account.isDefault) parts.push(t("primary"));
    if (account.currency !== baseCurrency) parts.push(account.currency);
    const subtitle = parts.join(" · ");
    return (
      <button
        key={account.id}
        type="button"
        onClick={() => {
          openEditor(account);
        }}
        className="press-row flex w-full items-center gap-3.5 pl-4 text-left"
      >
        <SymbolTile icon={look.icon} color={look.color} />
        <span
          className={cn(
            "row-sep flex min-w-0 flex-1 items-center gap-3 self-stretch pr-4",
            subtitle === "" ? "min-h-[52px]" : "min-h-[60px]",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="t-body truncate">{account.name}</span>
            {subtitle !== "" && <span className="t-footnote text-label-2 truncate">{subtitle}</span>}
          </span>
          <span className={cn("t-headline money shrink-0", closed && "text-label-2")}>
            {money(account.balanceMinor, account.currency)}
          </span>
        </span>
      </button>
    );
  };

  const current = draft?.account ?? null;
  const isArchived = current !== null && current.archivedAt !== null;
  const unused = current !== null && current.transactionCount === 0;
  const currentName = current?.name ?? "";
  const pending =
    create.isPending || update.isPending || archive.isPending || restore.isPending || makeDefault.isPending;

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: t("back") }} />

      <ScreenBody className="gap-5 pt-3">
        {active.length > 0 ? (
          <div className="flex flex-col gap-5">
            <p className="t-subhead text-label-2 money px-1">
              {t("total", { amount: money(total, baseCurrency) })}
            </p>
            <div className="inset-group">{active.map(row)}</div>
          </div>
        ) : (
          <div className="inset-group flex flex-col items-center gap-2 px-6 py-7 text-center">
            <Symbol name="account_balance_wallet" size={44} className="text-label-3" />
            <p className="t-headline">{t("emptyTitle")}</p>
            <p className="t-subhead text-label-2">{t("emptyBody")}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            openEditor(null);
          }}
          className="inset-group press-row text-tint t-headline flex h-[52px] w-full items-center justify-center gap-[7px]"
        >
          <Symbol name="add" size={22} weight={600} />
          {t("add")}
        </button>

        {archived.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title={t("archive")} />
            <div className="inset-group">{archived.map(row)}</div>
          </section>
        )}
      </ScreenBody>

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        detent="medium"
        title={current === null ? t("newAccount") : t("editAccount")}
      >
        {draft !== null && (
          <>
            <SheetHeader
              title={current === null ? t("newAccount") : current.name}
              onClose={() => {
                setEditing(false);
              }}
              trailing={
                <GlassButton
                  icon="check"
                  tinted
                  label={t("save")}
                  disabled={draft.name.trim() === "" || pending}
                  onClick={save}
                />
              }
            />
            <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-4 pt-4 pb-8 overscroll-contain *:shrink-0">
              <div className="flex flex-col gap-1.5">
                <div className="inset-group">
                  <FieldRow label={t("name")} htmlFor="account-name">
                    <RowInput
                      id="account-name"
                      value={draft.name}
                      autoFocus={current === null}
                      placeholder={t("namePlaceholder")}
                      onChange={(name) => {
                        setDraft({ ...draft, name });
                      }}
                    />
                  </FieldRow>
                  <MenuRow
                    label={t("type")}
                    value={t(`types.${draft.type}`)}
                    entries={accountTypes.map((type) => ({
                      key: type,
                      label: t(`types.${type}`),
                      icon: TYPE_LOOK[type].icon,
                      checked: type === draft.type,
                      onSelect: () => {
                        setDraft({ ...draft, type });
                      },
                    }))}
                  />
                  <CurrencyRow
                    label={t("currency")}
                    value={draft.currency}
                    onChange={(currency) => {
                      setDraft({ ...draft, currency });
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <AmountField
                  label={t("opening")}
                  value={draft.openingBalance}
                  currency={draft.currency}
                  signLabel={t("flipSign")}
                  onChange={(openingBalance) => {
                    setDraft({ ...draft, openingBalance });
                  }}
                />
                <p className="t-footnote text-label-2 px-4">
                  {current === null
                    ? t("openingHint")
                    : t("balanceNow", {
                        amount: money(current.balanceMinor, current.currency),
                        count: current.transactionCount,
                      })}
                </p>
              </div>

              {current !== null && !isArchived && (
                <div className="flex flex-col gap-1.5">
                  {current.isDefault ? (
                    <div className="inset-group t-body flex h-[52px] items-center gap-2 px-4">
                      <span className="flex-1">{t("isDefault")}</span>
                      <Symbol name="check" size={20} weight={600} className="text-tint" />
                    </div>
                  ) : (
                    <ActionRow
                      disabled={pending}
                      onClick={() => {
                        makeDefault.execute({ id: current.id });
                      }}
                    >
                      {t("makeDefault")}
                    </ActionRow>
                  )}
                  <p className="t-footnote text-label-2 px-4">{t("defaultHint")}</p>
                </div>
              )}

              {current !== null &&
                (isArchived ? (
                  <ActionRow
                    disabled={pending}
                    onClick={() => {
                      restore.execute({ id: current.id });
                    }}
                  >
                    {t("restoreAction")}
                  </ActionRow>
                ) : (
                  <ActionRow
                    destructive
                    onClick={() => {
                      setConfirmArchive(true);
                    }}
                  >
                    {unused ? t("deleteAction") : t("archiveAction")}
                  </ActionRow>
                ))}
            </div>
          </>
        )}
      </Sheet>

      <IosAlert
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={unused ? t("deleteTitle", { name: currentName }) : t("archiveTitle", { name: currentName })}
        message={unused ? t("deleteMessage") : t("archiveMessage")}
        cancelLabel={t("cancel")}
        confirmLabel={unused ? t("deleteConfirm") : t("archiveConfirm")}
        pending={archive.isPending}
        onConfirm={() => {
          if (current !== null) archive.execute({ id: current.id });
        }}
      />
    </>
  );
}
