import "server-only";
import { z } from "zod";

/**
 * Every environment variable the server reads enters through this module.
 * Parsing happens once, at import time, so a misconfigured deployment fails
 * immediately and loudly instead of at the first request that needs the value.
 */

const csvEmails = z
  .string()
  .min(1, "AUTH_ALLOWED_EMAILS must list at least one address")
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.email()).min(1));

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
    AUTH_URL: z.url().optional(),
    AUTH_GOOGLE_ID: z.string().default(""),
    AUTH_GOOGLE_SECRET: z.string().default(""),
    AUTH_ALLOWED_EMAILS: csvEmails,

    CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 chars"),

    /**
     * Bearer token for the Apple Pay / Wallet webhook. Optional: without it
     * the endpoint refuses every request, and the rest of the app is
     * unaffected. Empty counts as unset because docker compose passes "" for
     * a variable that was never filled in.
     */
    WALLET_WEBHOOK_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .min(16, "WALLET_WEBHOOK_SECRET must be at least 16 chars")
        .optional(),
    ),

    /**
     * LAN hosts the dev server is opened from (a phone on the same network).
     * next.config.ts reads it for allowedDevOrigins; the passkey app lock
     * reads it here so an assertion made from that host is an expected origin.
     */
    DEV_ORIGINS: z.string().default(""),

    APP_BASE_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, "APP_BASE_CURRENCY must be an ISO-4217 code")
      .default("EUR"),
  })
  /*
   * Nothing about signing in is required here any more. It is an address and a
   * password held in the database, so production needs no provider configured;
   * Google is optional and only appears when it is.
   *
   * What is still worth refusing is a *half* configuration. One Google variable
   * without the other silently drops the button from the login page, which
   * looks like a bug in the app rather than a missing value in the
   * environment.
   */
  .superRefine((value, ctx) => {
    const id = value.AUTH_GOOGLE_ID.length > 0;
    const secret = value.AUTH_GOOGLE_SECRET.length > 0;

    if (id !== secret) {
      ctx.addIssue({
        code: "custom",
        path: [id ? "AUTH_GOOGLE_SECRET" : "AUTH_GOOGLE_ID"],
        message:
          "Google needs both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or neither",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return parsed.data;
}

export const env: Env = parseEnv();

/** True when a Google OAuth app is configured. */
export const hasGoogleProvider: boolean =
  env.AUTH_GOOGLE_ID.length > 0 && env.AUTH_GOOGLE_SECRET.length > 0;

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (email === null || email === undefined) return false;
  return env.AUTH_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}
