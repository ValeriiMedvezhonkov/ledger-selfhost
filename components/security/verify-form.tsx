"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { submitFactorCode } from "@/app/verify/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface VerifyFormProps {
  readonly backupCodesLeft: number;
}

export function VerifyForm({ backupCodesLeft }: VerifyFormProps) {
  const t = useTranslations("security");
  const [code, setCode] = useState("");

  const submit = useAction(submitFactorCode);
  const error = submit.result.serverError;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit.execute({ code });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="factor-code">{t("codeLabel")}</Label>
        <Input
          id="factor-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          // A numeric keypad on phones, and the browser's own one-time-code
          // autofill on iOS and Android.
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          className="text-center text-lg tracking-[0.4em]"
          placeholder="000000"
          disabled={submit.isPending}
        />
        <p className="text-muted-foreground text-xs">{t("codeHint")}</p>
      </div>

      {error !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={submit.isPending}>
        {submit.isPending ? t("verifying") : t("verifyAction")}
      </Button>

      {backupCodesLeft > 0 && (
        <p className="text-muted-foreground text-center text-xs">
          {t("backupHint", { count: backupCodesLeft })}
        </p>
      )}
    </form>
  );
}
