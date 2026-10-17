"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("[app]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <span className="bg-destructive/10 text-destructive mb-3 flex size-11 items-center justify-center rounded-full">
        <TriangleAlertIcon className="size-5" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold">{t("pageTitle")}</h1>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {t("pageBody")}
      </p>
      {error.digest !== undefined && (
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          {error.digest}
        </p>
      )}
      <Button className="mt-4" onClick={reset}>
        {t("tryAgain")}
      </Button>
    </div>
  );
}
