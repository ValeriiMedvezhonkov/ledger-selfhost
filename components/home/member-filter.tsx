"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ios/controls";

/**
 * «Вся семья · Alex · Sam» — whose numbers Обзор shows. Lives in
 * the URL (?member=) so it survives a refresh; the lozenge moves at once
 * (optimistic) while the server re-renders the figures behind it.
 */
export function MemberFilter({
  members,
  current,
}: {
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly current: string | undefined;
}) {
  const t = useTranslations("ios.home");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(current ?? "all");

  return (
    <Segmented
      label={t("whose")}
      value={value}
      options={[
        { value: "all", label: t("everyone") },
        ...members.map((member) => ({ value: member.id, label: member.name })),
      ]}
      onChange={(next) => {
        startTransition(() => {
          setValue(next);
          const query = new URLSearchParams(params.toString());
          if (next === "all") query.delete("member");
          else query.set("member", next);
          const qs = query.toString();
          router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
        });
      }}
    />
  );
}
