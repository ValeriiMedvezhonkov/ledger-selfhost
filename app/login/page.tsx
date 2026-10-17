import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/auth";
import { hasGoogleProvider } from "@/lib/env";
import { Aurora } from "@/components/auth/aurora";
import { IosLoginForm } from "@/components/auth/ios-login-form";
import { Symbol } from "@/components/ios/symbol";
import { RevealOnFocus } from "@/components/ios/reveal-on-focus";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

const KNOWN_ERRORS = [
  "AccessDenied",
  "CredentialsSignin",
  "Configuration",
  "Verification",
] as const;

/**
 * Вход (boards L14 / D14): the app icon and wordmark over an aurora, the
 * sign-in fields on a glass panel that sits where a thumb reaches. Google
 * appears under the panel only when the provider is configured.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const [existing, t, ti, tn] = await Promise.all([
    getCurrentUser(),
    getTranslations("auth"),
    getTranslations("ios.auth"),
    getTranslations("nav"),
  ]);
  if (existing) redirect("/");

  const params = await props.searchParams;
  const rawError = params.error;
  const errorKey = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorMessage =
    errorKey === undefined
      ? null
      : (KNOWN_ERRORS as readonly string[]).includes(errorKey)
        ? t(`errors.${errorKey}`)
        : t("errors.fallback");

  return (
    <main className="relative min-h-screen-ios overflow-hidden">
      <Aurora />
      <div
        className="auth-stage relative mx-auto flex min-h-screen-ios max-w-[440px] flex-col justify-between px-3"
        style={{ paddingTop: "calc(var(--safe-top) + clamp(28px, 11dvh, 96px))" }}
      >
        <header className="flex flex-col items-center gap-3.5 text-center">
          <span className="grid size-[104px] place-items-center rounded-[26px] bg-[linear-gradient(200deg,#7d7aff,#4a3aa7)] text-white shadow-[0_16px_36px_rgb(74_58_167/0.4)] ring-1 ring-white/40">
            <Symbol name="account_balance_wallet" size={56} weight={500} />
          </span>
          <h1 className="text-[40px] leading-[48px] font-bold tracking-[-0.03em]">{tn("appName")}</h1>
          <p className="t-body text-label-2 max-w-[300px] leading-[1.35] whitespace-pre-line">{ti("tagline")}</p>
        </header>

        <RevealOnFocus className="flex flex-col gap-3 pt-10">
          {errorMessage !== null && (
            <p role="alert" className="glass glass-strong t-subhead text-ios-red rounded-3xl px-4 py-3 text-center">
              {errorMessage}
            </p>
          )}
          <IosLoginForm
            extra={
              hasGoogleProvider ? (
                <button
                  type="submit"
                  formAction={async () => {
                    "use server";
                    await signIn("google", { redirectTo: "/" });
                  }}
                  formNoValidate
                  className="bg-ios-card press t-headline flex h-[54px] items-center justify-center gap-2.5 rounded-full shadow-[0_2px_8px_rgb(0_0_0/0.1)]"
                >
                  {t("continueWithGoogle")}
                </button>
              ) : null
            }
          />
        </RevealOnFocus>
      </div>
    </main>
  );
}
