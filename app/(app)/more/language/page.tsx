import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { Screen } from "@/components/ios/screen";
import { LanguageScreen } from "@/components/more/ios/language-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.more.language");
  return { title: t("title") };
}

/** Язык (boards EL09 / E09). The locale is a cookie the client already knows. */
export default async function LanguagePage() {
  await requireUser();
  return (
    <Screen>
      <LanguageScreen />
    </Screen>
  );
}
