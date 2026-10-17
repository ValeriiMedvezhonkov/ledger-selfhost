"use server";

import { z } from "zod";
import { authAction, ActionError } from "@/lib/safe-action";
import { getTransactionDetail } from "@/lib/queries";
import { currencyExponent } from "@/lib/money";

/**
 * A stored transaction as the entry sheet's values, for «Изменить».
 *
 * The amount goes back as the magnitude in the same plain decimal the keypad
 * writes («24,80» / «24.80»), no grouping — the sheet treats it as typed
 * input, and the update action parses it with parseMoneyInput like any entry.
 */
export const getTransactionForEdit = authAction
  .inputSchema(z.object({ id: z.uuid(), locale: z.string().max(10) }))
  .action(async ({ parsedInput, ctx }) => {
    const detail = await getTransactionDetail(ctx.user.householdId, parsedInput.id);
    if (detail === null) throw new ActionError("transactionGone");
    if (detail.isTransfer) throw new ActionError("transferNotEditable");

    const exponent = currencyExponent(detail.currency);
    const magnitude = Math.abs(detail.amountMinor);
    const whole = Math.floor(magnitude / 10 ** exponent);
    const fraction = String(magnitude % 10 ** exponent).padStart(exponent, "0");
    const separator =
      new Intl.NumberFormat(parsedInput.locale)
        .formatToParts(1.1)
        .find((part) => part.type === "decimal")?.value ?? ".";
    const amount = exponent === 0 ? String(whole) : `${whole}${separator}${fraction}`;

    return {
      id: detail.id,
      type: detail.type === "income" ? ("income" as const) : ("expense" as const),
      accountId: detail.accountId,
      categoryId: detail.categoryId,
      paidByUserId: detail.paidByUserId ?? ctx.user.id,
      amount,
      currency: detail.currency,
      occurredOn: detail.occurredOn,
      merchant: detail.merchant,
      note: detail.note,
    };
  });
