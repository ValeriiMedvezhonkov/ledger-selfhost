import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { Screen } from "@/components/ios/screen";
import { AppearanceScreen } from "@/components/more/ios/appearance-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ios.more.appearance");
  return { title: t("title") };
}

/** Внешний вид (boards EL08 / E08). The theme lives on the device, so there is nothing to load. */
export default async function AppearancePage() {
  await requireUser();
  return (
    <Screen>
      <AppearanceScreen />
    </Screen>
  );
}
