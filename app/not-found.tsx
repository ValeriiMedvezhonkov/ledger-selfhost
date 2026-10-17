import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <main className="flex min-h-screen-ios flex-col items-center justify-center p-4 text-center">
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="mt-1 text-lg font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {t("notFoundBody")}
      </p>
      <Button className="mt-4" asChild>
        <Link href="/">{t("backToDashboard")}</Link>
      </Button>
    </main>
  );
}
