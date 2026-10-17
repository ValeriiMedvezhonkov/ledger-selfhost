"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { signInWithPassword } from "@/app/login/actions";
import { ProminentButton } from "@/components/ios/glass";
import { Sheet, SheetHeader } from "@/components/ios/sheet";
import { Symbol } from "@/components/ios/symbol";

function Field({ icon, children }: { readonly icon: "mail" | "lock"; readonly children: ReactNode }) {
  return (
    <label className="bg-ios-fill-3 flex h-[54px] items-center gap-2.5 rounded-full px-[18px]">
      <Symbol name={icon} size={20} className="text-label-2" />
      {children}
    </label>
  );
}

/**
 * The sign-in panel (board L14): email and password capsules on a glass
 * panel, a tinted «Войти», and «Забыли пароль?» — which can only explain,
 * because there is no email delivery: passwords are set from the server
 * (`npm run user:password`), so the honest answer is who can do that.
 */
export function IosLoginForm({ extra }: { readonly extra?: ReactNode }) {
  const t = useTranslations("ios.auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [help, setHelp] = useState(false);

  const submit = useAction(signInWithPassword, {
    onSuccess() {
      // Navigating server-side would race the cookie; refresh once it is set.
      router.replace("/");
      router.refresh();
    },
  });

  return (
    <>
      <form
        className="glass flex flex-col gap-3 rounded-t-[38px] rounded-b-[52px] px-[18px] pt-[22px] pb-[26px] [--glass-blur:18px]"
        onSubmit={(event) => {
          event.preventDefault();
          submit.execute({ email, password });
        }}
      >
        <Field icon="mail">
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="username"
            required
            placeholder={t("email")}
            aria-label={t("email")}
            disabled={submit.isPending}
            className="t-body placeholder:text-label-2 min-w-0 flex-1 bg-transparent outline-none"
          />
        </Field>
        <Field icon="lock">
          <input
            type={visible ? "text" : "password"}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            required
            placeholder={t("password")}
            aria-label={t("password")}
            disabled={submit.isPending}
            className="t-body placeholder:text-label-2 min-w-0 flex-1 bg-transparent outline-none"
          />
          <button
            type="button"
            aria-label={visible ? t("hide") : t("show")}
            onClick={() => {
              setVisible((value) => !value);
            }}
            className="text-label-2 grid size-8 place-items-center"
          >
            <Symbol name={visible ? "visibility" : "visibility_off"} size={20} />
          </button>
        </Field>

        {submit.result.serverError !== undefined && (
          <p role="alert" className="t-footnote text-ios-red px-2 text-center">
            {submit.result.serverError}
          </p>
        )}

        <ProminentButton type="submit" disabled={submit.isPending} className="h-[54px]">
          {submit.isPending ? t("signingIn") : t("signIn")}
        </ProminentButton>
        <button
          type="button"
          onClick={() => {
            setHelp(true);
          }}
          className="t-subhead text-tint pt-1"
        >
          {t("forgot")}
        </button>
        {extra}
      </form>

      <Sheet open={help} onOpenChange={setHelp} detent="medium" title={t("forgotTitle")}>
        <SheetHeader
          title={t("forgotTitle")}
          onClose={() => {
            setHelp(false);
          }}
        />
        <div className="flex flex-col gap-3 px-6 pt-4 pb-10">
          <p className="t-body">{t("forgotBody")}</p>
          <code className="bg-ios-fill-3 t-footnote rounded-xl px-3 py-2 font-mono">
            {t("forgotCommand")}
          </code>
          <p className="t-footnote text-label-2">{t("forgotLockout")}</p>
        </div>
      </Sheet>
    </>
  );
}
