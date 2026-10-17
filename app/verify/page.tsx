import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUserPendingFactor } from "@/lib/auth";
import { twoFactorState } from "@/lib/two-factor";
import { VerifyForm } from "@/components/security/verify-form";
import { Aurora } from "@/components/auth/aurora";
import { Symbol } from "@/components/ios/symbol";
import { RevealOnFocus } from "@/components/ios/reveal-on-focus";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security");
  return { title: t("verifyTitle") };
}

export default async function VerifyPage() {
  const t = await getTranslations("security");
  // Deliberately the ungated variant: this page runs before the factor is
  // satisfied, so the usual requireUser would redirect it to itself.
  const user = await requireUserPendingFactor();
  const factor = await twoFactorState(user.id);

  // Nothing to prove, or already proved — do not leave a dead-end page up.
  if (!factor.enabled || factor.verified) redirect("/");

  return (
    <main className="relative min-h-screen-ios overflow-hidden">
      <Aurora dim />
      <div
        className="auth-stage relative mx-auto flex min-h-screen-ios max-w-[440px] flex-col justify-center px-3"
      >
        <section className="glass flex flex-col gap-4 rounded-[38px] px-6 pt-7 pb-7 [--glass-blur:18px]">
          <span className="bg-tint grid size-14 place-items-center self-center rounded-[16px] text-white">
            <Symbol name="shield" size={30} weight={600} />
          </span>
          <div className="flex flex-col gap-1.5 text-center">
            <h1 className="t-title2">{t("verifyTitle")}</h1>
            <p className="t-subhead text-label-2">{t("verifyBody")}</p>
          </div>
          <RevealOnFocus>
            <VerifyForm backupCodesLeft={factor.backupCodesLeft} />
          </RevealOnFocus>
        </section>
      </div>
    </main>
  );
}
