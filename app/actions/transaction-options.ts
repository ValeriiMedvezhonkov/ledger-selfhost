"use server";

import { revalidatePath } from "next/cache";
import { ActionError, authAction } from "@/lib/safe-action";
import { z } from "zod";
import { listAccounts, listCategories, listMembers } from "@/lib/queries";
import { db } from "@/db";
import { categories as categoriesTable, quickPicks as quickPicksTable, transactions } from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { CATEGORY_COLOR_CHOICES } from "@/lib/chart-palette";
import {
  MAX_QUICK_PICKS,
  type QuickCategory,
  type QuickPick,
} from "@/lib/quick-picks";

/**
 * What to offer before there is any history to learn from.
 *
 * Categories, not shops. Naming the shops meant three of the six chips — Lidl,
 * Kaufland, Billa — were one category wearing different hats, spending the
 * row's scarce width on a question (which supermarket?) that none of the
 * reports ever ask back.
 */
const STARTER_SLUGS = [
  "groceries",
  "restaurants",
  "transport",
  "fuel",
  "health",
  "entertainment",
] as const;

const QUICK_PICK_COUNT = 6;

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/**
 * The chips worth putting one tap away.
 *
 * A household that has pinned categories gets exactly those, in the order it
 * chose. Otherwise the row is inferred from what has actually been entered over
 * the last three months, most frequent first, topped up from the starter list
 * while there is too little history for that to mean anything.
 *
 * Inference is a decent opening guess and nothing more, so any explicit choice
 * replaces it outright rather than merging: a row that keeps re-adding chips
 * you did not ask for is not a row you can rely on.
 */
async function loadQuickPicks(
  householdId: string,
  categories: readonly QuickCategory[],
): Promise<QuickPick[]> {
  const byId = new Map(categories.map((category) => [category.id, category]));

  const pinned = await db
    .select({ id: quickPicksTable.id, categoryId: quickPicksTable.categoryId })
    .from(quickPicksTable)
    .where(eq(quickPicksTable.householdId, householdId))
    .orderBy(asc(quickPicksTable.sortOrder), asc(quickPicksTable.createdAt));

  if (pinned.length > 0) {
    return pinned.flatMap((row) => {
      const category = byId.get(row.categoryId);
      // An archived category is filtered out of the list but the pin survives;
      // dropping it from the row is right, deleting the pin is not our call.
      if (category === undefined) return [];
      return [
        {
          id: row.id,
          label: category.name,
          categoryId: category.id,
          slug: category.slug,
          icon: category.icon,
          color: category.color,
          pinned: true,
        },
      ];
    });
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60_000);

  /*
   * Ordered by how often this household files an expense under each category,
   * not by how much it spends there. The row is about reaching for what you
   * reach for most, and one annual insurance premium outweighs a year of
   * groceries by value while being worth no tap at all.
   */
  const used = await db
    .select({ categoryId: transactions.categoryId, uses: sql<string>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.type, "expense"),
        isNotNull(transactions.categoryId),
        gte(transactions.occurredOn, since.toISOString().slice(0, 10)),
      ),
    )
    .groupBy(transactions.categoryId)
    .orderBy(desc(sql`count(*)`))
    .limit(QUICK_PICK_COUNT);

  const chosen: string[] = used
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null && byId.has(id));

  const idBySlug = new Map(
    categories
      .filter((category) => category.slug !== null)
      .map((category) => [category.slug ?? "", category.id]),
  );

  for (const slug of STARTER_SLUGS) {
    if (chosen.length >= QUICK_PICK_COUNT) break;
    const id = idBySlug.get(slug);
    // A household that renamed or deleted the category simply skips it.
    if (id !== undefined && !chosen.includes(id)) chosen.push(id);
  }

  return chosen.slice(0, QUICK_PICK_COUNT).flatMap((id) => {
    const category = byId.get(id);
    if (category === undefined) return [];
    return [
      {
        id: `category:${id}`,
        label: category.name,
        categoryId: id,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        pinned: false,
      },
    ];
  });
}

function toQuickCategories(
  rows: Awaited<ReturnType<typeof listCategories>>,
): QuickCategory[] {
  return rows.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    kind: category.kind,
    color: category.color,
  }));
}

/**
 * The accounts, categories and members the add-transaction form needs.
 *
 * Fetched on demand rather than rendered into every page. The form is now
 * reachable from anywhere, but it is opened rarely — loading its options into
 * the layout would put three queries on every page view to serve the few where
 * somebody actually taps the button.
 */
export const getTransactionOptions = authAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const [accounts, categoryRows, members] = await Promise.all([
      listAccounts(ctx.user.householdId),
      listCategories(ctx.user.householdId),
      listMembers(ctx.user.householdId),
    ]);

    const categories = toQuickCategories(categoryRows);

    return {
      quick: await loadQuickPicks(ctx.user.householdId, categories),
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
      })),
      categories,
      members,
      baseCurrency: ctx.user.baseCurrency,
      currentUserId: ctx.user.id,
      // «Основной» — where a new entry lands unless another is picked.
      defaultAccountId: accounts.find((account) => account.isDefault)?.id ?? null,
    };
  });

/**
 * Replaces the pinned row wholesale.
 *
 * Sent as the full ordered list rather than add/remove deltas so the row cannot
 * drift out of step with what the editor is showing — the client's order is the
 * order, and clearing it hands the row back to inference.
 */
export const saveQuickPicks = authAction
  .inputSchema(
    z.object({
      categoryIds: z.array(z.uuid()).max(MAX_QUICK_PICKS),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const wanted = [...new Set(parsedInput.categoryIds)];

    if (wanted.length > 0) {
      // Straight from the client, so confirm every id is a category this
      // household owns before it lands in a row keyed by household.
      const owned = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.householdId, ctx.user.householdId),
            inArray(categoriesTable.id, wanted),
          ),
        );

      if (owned.length !== wanted.length) throw new ActionError("categoryMissing");
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(quickPicksTable)
        .where(eq(quickPicksTable.householdId, ctx.user.householdId));

      if (wanted.length > 0) {
        await tx.insert(quickPicksTable).values(
          wanted.map((categoryId, index) => ({
            householdId: ctx.user.householdId,
            categoryId,
            sortOrder: index,
          })),
        );
      }
    });

    const categories = toQuickCategories(
      await listCategories(ctx.user.householdId),
    );

    revalidateAll();
    return {
      quick: await loadQuickPicks(ctx.user.householdId, categories),
      categories,
    };
  });

/**
 * Creates a category from inside the add form and hands back the new id.
 *
 * The categories page is the place to give one an icon, a colour and a parent;
 * this exists so that noticing a missing category mid-entry costs a name and
 * nothing else. Colour is assigned from the chart palette so the new one is
 * legible in the reports without anybody choosing.
 */
export const createQuickCategory = authAction
  .inputSchema(
    z.object({
      name: z.string().min(1, "categoryName").max(40).trim(),
      kind: z.enum(["income", "expense"]).default("expense"),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const existing = await listCategories(ctx.user.householdId);

    const clash = existing.find(
      (category) =>
        category.name.toLocaleLowerCase() ===
        parsedInput.name.toLocaleLowerCase(),
    );
    if (clash !== undefined) throw new ActionError("categoryDuplicate");

    const color =
      CATEGORY_COLOR_CHOICES[existing.length % CATEGORY_COLOR_CHOICES.length] ??
      "#2a78d6";

    const [created] = await db
      .insert(categoriesTable)
      .values({
        householdId: ctx.user.householdId,
        name: parsedInput.name,
        kind: parsedInput.kind,
        icon: "Circle",
        color,
      })
      .returning({ id: categoriesTable.id });

    if (created === undefined) throw new ActionError("unexpected");

    const categories = toQuickCategories(
      await listCategories(ctx.user.householdId),
    );

    revalidateAll();
    return { id: created.id, categories };
  });
