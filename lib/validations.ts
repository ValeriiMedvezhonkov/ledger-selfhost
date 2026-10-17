import { z } from "zod";
import { ISO_DATE_PATTERN } from "@/lib/date";
import { SUPPORTED_CURRENCIES } from "@/lib/money";

/**
 * The single source of truth for input shapes. Form components and Server
 * Actions both consume these; TypeScript types are inferred from them so a
 * schema and its type can never drift apart.
 */

export const uuid = z.uuid();

export const isoDate = z
  .string()
  .regex(ISO_DATE_PATTERN, "Use the date picker (YYYY-MM-DD)");

export const currencyCode = z.enum(SUPPORTED_CURRENCIES);

/** Amounts arrive as the raw string the user typed and are parsed server-side. */
export const moneyInput = z
  .string()
  .min(1, "enterAmount")
  .max(24, "amountTooLong");

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "pickColour");

/**
 * Deliberately no `.transform()`: a transform makes a schema's input and output
 * types differ, and react-hook-form needs them identical. Empty strings are
 * normalised to null in the action instead.
 */
const optionalNote = z
  .string()
  .max(280, "noteTooLong")
  .nullable();

/** The row's title. Short, because it is a name on a list, not a sentence. */
const optionalMerchant = z
  .string()
  .max(80, "merchantTooLong")
  .nullable();

/**
 * The "whose" field also takes this literal: «пополам», one row per member,
 * each carrying half. Kept a plain string in the schema (no union) so the form
 * type stays a string the select can bind to.
 */
export const SPLIT_PAID_BY = "split";

// --- accounts -------------------------------------------------------------

export const accountTypes = [
  "checking",
  "savings",
  "cash",
  "credit",
  "investment",
] as const;

export const accountFormSchema = z.object({
  name: z.string().min(1, "accountName").max(60).trim(),
  type: z.enum(accountTypes),
  currency: currencyCode,
  openingBalance: moneyInput,
});

export const createAccountSchema = accountFormSchema;
export const updateAccountSchema = accountFormSchema.extend({ id: uuid });
export const accountIdSchema = z.object({ id: uuid });

export type AccountFormValues = z.infer<typeof accountFormSchema>;

// --- categories -----------------------------------------------------------

export const categoryFormSchema = z.object({
  name: z.string().min(1, "categoryName").max(40).trim(),
  kind: z.enum(["income", "expense"]),
  icon: z.string().min(1).max(40),
  color: hexColor,
  parentId: uuid.nullable().optional(),
});

export const createCategorySchema = categoryFormSchema;
export const updateCategorySchema = categoryFormSchema.extend({ id: uuid });

/** Deleting a category moves its transactions somewhere; the user picks where. */
export const deleteCategorySchema = z.object({
  id: uuid,
  reassignToId: uuid.nullable(),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

// --- transactions ---------------------------------------------------------

export const transactionFormSchema = z
  .object({
    type: z.enum(["income", "expense", "transfer"]),
    accountId: uuid,
    /** Destination account, transfers only. */
    toAccountId: uuid.optional(),
    categoryId: uuid.nullable().optional(),
    /** A member id, or SPLIT_PAID_BY for half each. */
    paidByUserId: z.string().min(1),
    amount: moneyInput,
    currency: currencyCode,
    /** Rate to base currency; ignored when currency === base. */
    fxRate: z.string().optional(),
    occurredOn: isoDate,
    merchant: optionalMerchant,
    note: optionalNote,
  })
  .superRefine((value, ctx) => {
    if (value.type === "transfer") {
      if (!value.toAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "chooseTransferTarget",
        });
      } else if (value.toAccountId === value.accountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "transferDistinct",
        });
      }
      return;
    }

    if (value.categoryId === null || value.categoryId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "chooseCategory",
      });
    }
  });

export const createTransactionSchema = transactionFormSchema;
export const updateTransactionSchema = z.object({
  id: uuid,
  values: transactionFormSchema,
});
export const transactionIdSchema = z.object({ id: uuid });
export const deleteManySchema = z.object({
  ids: z.array(uuid).min(1, "selectTransaction"),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;

/** «Сделать регулярной» — daily is left out: nobody pays the same shop daily. */
export const makeRecurringSchema = z.object({
  id: uuid,
  frequency: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
});

export const changeCategorySchema = z.object({ id: uuid, categoryId: uuid });

/**
 * Category ids from the URL: `?categoryIds=a&categoryIds=b` arrives as an
 * array, `?categoryIds=a,b` as one string, and a client calling the count
 * action sends an array. All three normalise to a de-duplicated list.
 */
const categoryIdList = z.preprocess((value: unknown): unknown => {
  if (value === undefined || value === null || value === "") return [];
  const parts: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  const flat = parts.flatMap((part): unknown[] =>
    typeof part === "string" ? part.split(",").map((piece) => piece.trim()) : [part],
  );
  return [...new Set(flat)].filter((part) => part !== "");
}, z.array(uuid).max(50));

export const transactionFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: uuid.optional(),
  /** Single-category filter, kept for links made before multi-select. */
  categoryId: uuid.optional(),
  /** Any of these categories. Combined with `categoryId` when both are set. */
  categoryIds: categoryIdList,
  type: z.enum(["income", "expense", "transfer"]).optional(),
  paidByUserId: z.string().optional(),
  q: z.string().max(80).optional(),
  sort: z.enum(["date-desc", "date-asc", "amount-desc", "amount-asc"]).default("date-desc"),
  page: z.coerce.number().int().min(1).default(1),
});

export type TransactionFilters = z.infer<typeof transactionFilterSchema>;

// --- budgets --------------------------------------------------------------

export const budgetFormSchema = z.object({
  categoryId: uuid,
  periodStart: isoDate,
  limit: moneyInput,
});

export const createBudgetSchema = budgetFormSchema;
export const updateBudgetSchema = budgetFormSchema.extend({ id: uuid });
export const budgetIdSchema = z.object({ id: uuid });
export const copyBudgetsSchema = z.object({
  fromPeriod: isoDate,
  toPeriod: isoDate,
});

export type BudgetFormValues = z.infer<typeof budgetFormSchema>;

// --- recurring ------------------------------------------------------------

export const recurringFormSchema = z.object({
  name: z.string().min(1, "ruleName").max(60).trim(),
  type: z.enum(["income", "expense"]),
  accountId: uuid,
  categoryId: uuid.nullable().optional(),
  paidByUserId: z.string().min(1),
  amount: moneyInput,
  currency: currencyCode,
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(52),
  startOn: isoDate,
  endOn: isoDate.nullable().optional(),
  note: optionalNote,
});

export const createRecurringSchema = recurringFormSchema;
export const updateRecurringSchema = recurringFormSchema.extend({ id: uuid });
export const recurringIdSchema = z.object({ id: uuid });
export const toggleRecurringSchema = z.object({ id: uuid, active: z.boolean() });

export type RecurringFormValues = z.infer<typeof recurringFormSchema>;

// --- goals ----------------------------------------------------------------

export const goalFormSchema = z.object({
  name: z.string().min(1, "goalName").max(60).trim(),
  target: moneyInput,
  currency: currencyCode,
  targetDate: isoDate.nullable().optional(),
  accountId: uuid.nullable().optional(),
});

export const createGoalSchema = goalFormSchema;
export const updateGoalSchema = goalFormSchema.extend({ id: uuid });
export const goalIdSchema = z.object({ id: uuid });
export const contributeSchema = z.object({
  goalId: uuid,
  amount: moneyInput,
  occurredOn: isoDate,
});

export type GoalFormValues = z.infer<typeof goalFormSchema>;

// --- import ---------------------------------------------------------------

export const importMappingSchema = z.object({
  accountId: uuid,
  dateColumn: z.string().min(1, "dateColumn"),
  amountColumn: z.string().min(1, "amountColumn"),
  noteColumn: z.string().optional(),
  categoryColumn: z.string().optional(),
  dateFormat: z.enum(["iso", "dmy", "mdy"]).default("iso"),
  /** Rows the preview flagged as duplicates that the user chose to keep. */
  skipDuplicates: z.boolean().default(true),
});

export const importCommitSchema = importMappingSchema.extend({
  csv: z.string().min(1).max(2_000_000),
});

export type ImportMapping = z.infer<typeof importMappingSchema>;

// --- settings -------------------------------------------------------------

export const profileSchema = z.object({
  displayName: z.string().min(1, "displayName").max(40).trim(),
  color: hexColor,
});

export const householdSchema = z.object({
  name: z.string().min(1, "householdName").max(60).trim(),
  baseCurrency: currencyCode,
});

export const renameHouseholdSchema = z.object({
  name: z.string().min(1, "householdName").max(60).trim(),
});

export const baseCurrencySchema = z.object({ baseCurrency: currencyCode });

/**
 * One emoji — which can be several code points (skin tones, ZWJ families,
 * flags). The regex checks every character is an emoji part and at least one is
 * a pictograph (digits are "emoji components" too, for keycaps); the segmenter
 * then checks it is a single grapheme, so "🐻🐻" is two and is refused.
 */
export const avatarEmoji = z
  .string()
  .max(32, "pickEmoji")
  .regex(
    /^(?=.*(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|\u200d|\ufe0f)+$/u,
    "pickEmoji",
  )
  .refine(
    (value) => [...new Intl.Segmenter().segment(value)].length === 1,
    "pickEmoji",
  );

export const updateMemberSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1, "displayName").max(40).trim(),
  color: hexColor,
  avatarEmoji: avatarEmoji.nullable(),
});

export type UpdateMemberValues = z.infer<typeof updateMemberSchema>;
