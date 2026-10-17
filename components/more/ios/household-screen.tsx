"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  renameHousehold,
  setBaseCurrency,
  updateMember,
} from "@/app/actions/household";
import { CATEGORY_COLOR_CHOICES } from "@/lib/chart-palette";
import { currencyMeta } from "@/lib/currencies";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "@/lib/money";
import { NavBar } from "@/components/ios/nav-bar";
import { ScreenBody } from "@/components/ios/screen";
import { GlassPill } from "@/components/ios/glass";
import { ListRow } from "@/components/ios/list";
import { MemberAvatar, TogglePill } from "@/components/ios/controls";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";
import { Footnote } from "@/components/more/ios/parts";
import { cn } from "@/lib/utils";

export interface HouseholdMember {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatarEmoji: string | null;
}

interface Failure { error: { serverError?: string | undefined } }

/** «EUR · €»; just «EUR» where the symbol is the code itself. */
function currencyValue(code: string): string {
  const symbol = currencyMeta(code).symbol;
  return symbol === "" || symbol === code ? code : `${code} · ${symbol}`;
}

const FIELD =
  "bg-ios-fill-3 t-body h-[46px] w-full rounded-full px-4 outline-none placeholder:text-label-3 focus-visible:ring-2 focus-visible:ring-tint";

/**
 * Семья (boards EL01 / E01): the household's name, each member's name,
 * colour and avatar, the base currency, and — read-only — how many addresses
 * may sign in. Every edit opens a floating sheet; nothing on the screen
 * itself is an input, as in Settings.
 */
export function HouseholdScreen({
  name,
  baseCurrency,
  members,
  allowedCount,
}: {
  readonly name: string;
  readonly baseCurrency: string;
  readonly members: readonly HouseholdMember[];
  readonly allowedCount: number;
}) {
  const t = useTranslations("ios.more.household");
  const tm = useTranslations("ios.more");
  const [renaming, setRenaming] = useState(false);
  const [renameKey, setRenameKey] = useState(0);
  const [memberOpen, setMemberOpen] = useState(false);
  const [member, setMember] = useState<HouseholdMember | null>(null);
  const [currencyOpen, setCurrencyOpen] = useState(false);

  return (
    <>
      <NavBar title={t("title")} back={{ href: "/more", label: tm("title") }} />

      <ScreenBody className="gap-[22px] pt-2">
        <div className="inset-group">
          <ListRow
            title={t("name")}
            tile={{ icon: "home", color: "var(--ios-tint)" }}
            value={name}
            onClick={() => {
              setRenameKey((k) => k + 1);
              setRenaming(true);
            }}
          />
        </div>

        <div className="inset-group">
          {members.map((m) => (
            <ListRow
              key={m.id}
              title={<span className="font-medium">{m.name}</span>}
              subtitle={t("memberSubtitle")}
              tile={<MemberAvatar name={m.name} color={m.color} size={36} />}
              onClick={() => {
                setMember(m);
                setMemberOpen(true);
              }}
            />
          ))}
        </div>

        <div className="inset-group">
          <ListRow
            title={t("baseCurrency")}
            tile={{ icon: "euro", color: "var(--ios-green)" }}
            value={currencyValue(baseCurrency)}
            onClick={() => {
              setCurrencyOpen(true);
            }}
          />
        </div>
        <Footnote>{t("currencyFootnote")}</Footnote>

        <div className="inset-group">
          <ListRow
            title={t("allowed")}
            tile={{ icon: "shield", color: "var(--ios-gray)" }}
            value={String(allowedCount)}
            accessory="none"
          />
        </div>
        <Footnote>{t("allowedFootnote")}</Footnote>
      </ScreenBody>

      <Sheet open={renaming} onOpenChange={setRenaming} detent="medium" title={t("renameTitle")}>
        <RenameForm
          key={renameKey}
          initial={name}
          onDone={() => {
            setRenaming(false);
          }}
        />
      </Sheet>

      <Sheet
        open={memberOpen}
        onOpenChange={setMemberOpen}
        detent="medium"
        title={member?.name ?? t("memberTitle")}
        onClosed={() => {
          setMember(null);
        }}
      >
        {member !== null && (
          <MemberForm
            key={member.id}
            member={member}
            onDone={() => {
              setMemberOpen(false);
            }}
          />
        )}
      </Sheet>

      <Sheet open={currencyOpen} onOpenChange={setCurrencyOpen} detent="medium" title={t("baseCurrency")}>
        <CurrencyPicker
          current={baseCurrency}
          onDone={() => {
            setCurrencyOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/* --------------------------------------------------------------- rename */

function RenameForm({ initial, onDone }: { readonly initial: string; readonly onDone: () => void }) {
  const t = useTranslations("ios.more.household");
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const save = useAction(renameHousehold, {
    onSuccess: () => {
      toast.success(t("saved"));
      onDone();
      router.refresh();
    },
    onError: ({ error }: Failure) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });
  const trimmed = value.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "") save.execute({ name: trimmed });
      }}
      className="flex flex-col"
    >
      <SheetHeader
        title={t("renameTitle")}
        onClose={onDone}
        trailing={
          <GlassPill tinted type="submit" disabled={trimmed === "" || save.isPending}>
            {t("done")}
          </GlassPill>
        }
      />
      <div className="flex flex-col gap-2 px-4 pt-4 pb-8">
        <input
          aria-label={t("name")}
          value={value}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className={FIELD}
        />
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- member */

/** Animals first — the household's own pair is a monkey and a bear. */
const EMOJI_PICKS = ["🐒", "🐻", "🦊", "🐼", "🐨", "🐯", "🦁", "🐸", "🐧", "🦉", "🐙", "🦄"] as const;

function MemberForm({ member, onDone }: { readonly member: HouseholdMember; readonly onDone: () => void }) {
  const t = useTranslations("ios.more.household");
  const router = useRouter();
  const [displayName, setDisplayName] = useState(member.name);
  const [color, setColor] = useState(member.color);
  const [emoji, setEmoji] = useState<string | null>(member.avatarEmoji);

  const save = useAction(updateMember, {
    onSuccess: () => {
      toast.success(t("saved"));
      onDone();
      router.refresh();
    },
    onError: ({ error }: Failure) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });

  // A colour picked before the palette existed stays offered, so saving a
  // name never forces a repaint (the action accepts the stored colour too).
  const palette = CATEGORY_COLOR_CHOICES.some((c) => c.toLowerCase() === member.color.toLowerCase())
    ? CATEGORY_COLOR_CHOICES
    : [member.color, ...CATEGORY_COLOR_CHOICES];
  const trimmed = displayName.trim();
  const preview = trimmed === "" ? member.name : trimmed;
  const glyph = emoji ?? preview.charAt(0).toUpperCase();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === "") return;
        save.execute({ userId: member.id, displayName: trimmed, color, avatarEmoji: emoji });
      }}
      className="flex min-h-0 flex-col"
    >
      <SheetHeader
        title={preview}
        onClose={onDone}
        trailing={
          <GlassPill tinted type="submit" disabled={trimmed === "" || save.isPending}>
            {t("done")}
          </GlassPill>
        }
      />
      <div className="flex max-h-[68dvh] flex-col gap-4 overflow-y-auto px-4 pt-3 pb-8 *:shrink-0">
        <div className="flex justify-center py-1">
          <span
            aria-hidden
            className={cn(
              "grid size-[76px] place-items-center rounded-full font-bold text-white",
              emoji === null ? "text-[34px]" : "text-[40px]",
            )}
            style={{ backgroundColor: color }}
          >
            {glyph}
          </span>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("displayName")}</h3>
          <input
            aria-label={t("displayName")}
            value={displayName}
            maxLength={40}
            autoComplete="off"
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            className={FIELD}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("colour")}</h3>
          <div className="flex flex-wrap gap-3">
            {palette.map((choice) => {
              const selected = choice.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={choice}
                  type="button"
                  aria-label={t("colourOption", { colour: choice })}
                  aria-pressed={selected}
                  onClick={() => {
                    setColor(choice);
                  }}
                  className="press grid size-9 place-items-center rounded-full"
                  style={{
                    backgroundColor: choice,
                    boxShadow: selected ? `0 0 0 2px var(--ios-card-2), 0 0 0 4px ${choice}` : undefined,
                  }}
                >
                  {selected && <Symbol name="check" size={18} weight={700} className="text-white" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="t-footnote text-label-2 font-semibold">{t("avatar")}</h3>
          <div className="grid grid-cols-6 gap-2">
            {EMOJI_PICKS.map((pick) => (
              <button
                key={pick}
                type="button"
                aria-pressed={emoji === pick}
                onClick={() => {
                  setEmoji(pick);
                }}
                className={cn(
                  "press grid h-11 place-items-center rounded-[14px] text-[24px]",
                  emoji === pick ? "bg-tint-soft ring-2 ring-tint" : "bg-ios-fill-3",
                )}
              >
                {pick}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label={t("ownEmoji")}
              placeholder={t("ownEmoji")}
              value={emoji !== null && !(EMOJI_PICKS as readonly string[]).includes(emoji) ? emoji : ""}
              maxLength={16}
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value.trim();
                setEmoji(next === "" ? null : next);
              }}
              className={cn(FIELD, "flex-1")}
            />
            <TogglePill
              selected={emoji === null}
              onClick={() => {
                setEmoji(null);
              }}
            >
              {t("initial")}
            </TogglePill>
          </div>
        </section>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- currency */

function CurrencyPicker({ current, onDone }: { readonly current: string; readonly onDone: () => void }) {
  const t = useTranslations("ios.more.household");
  const router = useRouter();
  const save = useAction(setBaseCurrency, {
    onSuccess: () => {
      toast.success(t("currencySaved"));
      onDone();
      router.refresh();
    },
    onError: ({ error }: Failure) => {
      toast.error(error.serverError ?? t("failed"));
    },
  });

  const choose = (code: CurrencyCode) => {
    if (code === current) {
      onDone();
      return;
    }
    save.execute({ baseCurrency: code });
  };

  return (
    <>
      <SheetHeader title={t("baseCurrency")} onClose={onDone} />
      <div className="flex max-h-[64dvh] flex-col gap-2 overflow-y-auto px-4 pt-3 pb-8 *:shrink-0">
        <div className="bg-ios-card overflow-clip rounded-[26px]">
          {SUPPORTED_CURRENCIES.map((code) => {
            const meta = currencyMeta(code);
            return (
              <ListRow
                key={code}
                title={code}
                tile={
                  <span aria-hidden className="grid size-[30px] shrink-0 place-items-center text-[22px]">
                    {meta.flag}
                  </span>
                }
                {...(meta.symbol === code || meta.symbol === "" ? {} : { value: meta.symbol })}
                accessory={code === current ? "check" : "none"}
                disabled={save.isPending}
                onClick={() => {
                  choose(code);
                }}
              />
            );
          })}
        </div>
        <Footnote className="mt-2">{t("currencyFootnote")}</Footnote>
      </div>
    </>
  );
}
