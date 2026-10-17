"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { skCategoryKeyForName, type SkCategoryKey } from "@/lib/merchants";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { ActionError, authAction } from "@/lib/safe-action";
import { importCommitSchema, importMappingSchema } from "@/lib/validations";
import { ONE_TO_ONE, convertToBase } from "@/lib/money";
import { addMonthsISO, todayISO } from "@/lib/date";
import { serverNow } from "@/lib/now";
import { mapRows, parseCsv, type ExistingKey } from "@/lib/csv";
import { z } from "zod";

const previewSchema = importMappingSchema.extend({
  csv: z.string().min(1).max(2_000_000),
});

async function loadExisting(householdId: string): Promise<ExistingKey[]> {
  // Duplicate detection only looks back two years; older rows will not collide
  // with a fresh bank export in practice and the scan stays cheap.
  const since = addMonthsISO(todayISO(serverNow()), -24);

  const rows = await db
    .select({
      occurredOn: transactions.occurredOn,
      amountMinor: transactions.amountMinor,
      merchant: transactions.merchant,
      note: transactions.note,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.occurredOn, since),
      ),
    );

  /*
   * A bank's description can live in either column now: an earlier import
   * stored it as the merchant when nothing was recognised, and as the note
   * when a canonical name took the title (see commitImport). Rows from before
   * migration 0010 hold it as the merchant. Offering both keys means a
   * re-import is caught as a duplicate whichever way the row was written.
   */
  return rows.flatMap((row) => [
    { occurredOn: row.occurredOn, amountMinor: row.amountMinor, note: row.merchant },
    { occurredOn: row.occurredOn, amountMinor: row.amountMinor, note: row.note },
  ]);
}

async function assertAccount(
  householdId: string,
  accountId: string,
): Promise<string> {
  const rows = await db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
    .limit(1);

  const account = rows[0];
  if (!account) throw new ActionError("accountMissing");
  return account.currency;
}

/** Parse and validate without writing anything. Drives the preview table. */
export const previewImport = authAction
  .inputSchema(previewSchema)
  .action(async ({ parsedInput, ctx }) => {
    const currency = await assertAccount(
      ctx.user.householdId,
      parsedInput.accountId,
    );

    const parsed = parseCsv(parsedInput.csv);
    if (parsed.rows.length === 0) {
      throw new ActionError("csvEmpty");
    }

    const existing = await loadExisting(ctx.user.householdId);
    const result = mapRows(
      parsed,
      {
        dateColumn: parsedInput.dateColumn,
        amountColumn: parsedInput.amountColumn,
        noteColumn: parsedInput.noteColumn,
        categoryColumn: parsedInput.categoryColumn,
        dateFormat: parsedInput.dateFormat,
        currency,
      },
      existing,
      serverNow(),
    );

    return {
      ok: true as const,
      currency,
      total: parsed.rows.length,
      valid: result.valid.slice(0, 200),
      validCount: result.valid.length,
      duplicateCount: result.valid.filter((row) => row.isDuplicate).length,
      errors: result.errors.slice(0, 50),
      errorCount: result.errors.length,
      recognisedCount: result.valid.filter((row) => row.merchant !== null).length,
    };
  });

/**
 * Write the import. Everything happens in one database transaction — a file
 * that fails halfway leaves the ledger exactly as it was, rather than half
 * imported with no way to tell which rows landed.
 */
export const commitImport = authAction
  .inputSchema(importCommitSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { householdId, id: actorId } = ctx.user;
    const currency = await assertAccount(householdId, parsedInput.accountId);

    const parsed = parseCsv(parsedInput.csv);
    const existing = await loadExisting(householdId);

    const result = mapRows(
      parsed,
      {
        dateColumn: parsedInput.dateColumn,
        amountColumn: parsedInput.amountColumn,
        noteColumn: parsedInput.noteColumn,
        categoryColumn: parsedInput.categoryColumn,
        dateFormat: parsedInput.dateFormat,
        currency,
      },
      existing,
      serverNow(),
    );

    const toImport = parsedInput.skipDuplicates
      ? result.valid.filter((row) => !row.isDuplicate)
      : result.valid;

    if (toImport.length === 0) {
      throw new ActionError("nothingToImport");
    }

    // A row's category can come from the file itself or from the recognised
    // merchant; both are looked up so either path can resolve to a real row.
    const names = [
      ...new Set(
        toImport
          .flatMap((row) => [row.categoryName, row.suggestedCategory])
          .filter((name): name is string => name !== null),
      ),
    ];

    // The merchant guess is a Slovak catalogue name; its key is the slug of
    // the shipped category, which still matches after the category was
    // shown — or stored — in another language.
    const slugs = [
      ...new Set(
        toImport
          .map((row) => (row.suggestedCategory === null ? null : skCategoryKeyForName(row.suggestedCategory)))
          .filter((slug): slug is SkCategoryKey => slug !== null),
      ),
    ];

    const imported = await db.transaction(async (tx) => {
      const categoryIdByName = new Map<string, string>();
      const categoryIdBySlug = new Map<string, string>();

      if (names.length > 0 || slugs.length > 0) {
        const found = await tx
          .select({ id: categories.id, name: categories.name, slug: categories.slug })
          .from(categories)
          .where(
            and(
              eq(categories.householdId, householdId),
              or(
                names.length > 0 ? inArray(categories.name, names) : undefined,
                slugs.length > 0 ? inArray(categories.slug, slugs) : undefined,
              ),
            ),
          );

        for (const row of found) {
          categoryIdByName.set(row.name.toLowerCase(), row.id);
          if (row.slug !== null) categoryIdBySlug.set(row.slug, row.id);
        }
      }

      const values = toImport.map((row) => {
        const amountMinor = row.amountMinor;
        // The file's own category wins; the merchant guess is the fallback.
        const fromFile =
          row.categoryName !== null
            ? (categoryIdByName.get(row.categoryName.toLowerCase()) ?? null)
            : null;
        const suggestedSlug =
          row.suggestedCategory === null ? null : skCategoryKeyForName(row.suggestedCategory);
        const fromMerchant =
          row.suggestedCategory !== null
            ? (categoryIdByName.get(row.suggestedCategory.toLowerCase()) ??
              (suggestedSlug === null ? null : (categoryIdBySlug.get(suggestedSlug) ?? null)))
            : null;
        const categoryId = fromFile ?? fromMerchant;

        return {
          householdId,
          accountId: parsedInput.accountId,
          categoryId,
          createdByUserId: actorId,
          paidByUserId: actorId,
          // Sign in the file decides direction: banks export outgoings as
          // negative, so an inferred type would fight the source data.
          type: amountMinor >= 0 ? ("income" as const) : ("expense" as const),
          amountMinor,
          currency,
          fxRateToBase: ONE_TO_ONE,
          amountBaseMinor: convertToBase(amountMinor, ONE_TO_ONE),
          occurredOn: row.occurredOn,
          // A recognised shop becomes the title ("Lidl") and the bank's raw
          // line is kept as the note, so nothing the statement said is lost.
          // Unrecognised, the raw line is the best title there is.
          merchant: row.merchant ?? row.note,
          note: row.merchant !== null && row.merchant !== row.note ? row.note : null,
          source: "import" as const,
        };
      });

      await tx.insert(transactions).values(values);
      return values.length;
    });

    revalidatePath("/", "layout");

    return {
      ok: true as const,
      imported,
      skipped: result.valid.length - toImport.length,
      failed: result.errors.length,
      recognised: toImport.filter((row) => row.merchant !== null).length,
    };
  });
