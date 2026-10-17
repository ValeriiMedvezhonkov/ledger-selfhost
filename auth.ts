import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  authAccounts,
  households,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";
import { env, hasGoogleProvider, isAllowedEmail } from "@/lib/env";
import { recordAttempt } from "@/lib/auth-attempts";
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/session-config";

/**
 * The app is closed. The allowlist in AUTH_ALLOWED_EMAILS is the only way in,
 * and it is enforced in the `signIn` callback — before any account or session
 * row is created — so a rejected address leaves no trace in the database.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  trustHost: true,
  providers: hasGoogleProvider
    ? [
        Google({
          clientId: env.AUTH_GOOGLE_ID,
          clientSecret: env.AUTH_GOOGLE_SECRET,
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, profile }) {
      const email = user.email ?? profile?.email ?? null;
      const allowed =
        isAllowedEmail(email) && profile?.email_verified !== false;

      // Recorded here rather than in the UI because this is where the decision
      // is actually made — including for addresses that are not on the
      // allowlist, which never reach a page and are the ones worth seeing.
      await recordAttempt({
        email,
        stage: "signin",
        outcome: allowed ? "success" : "failure",
      });

      return allowed;
    },
    session({ session, user }) {
      session.user.id = user.id;
      session.user.householdId = user.householdId ?? null;
      session.user.displayName = user.displayName ?? null;
      session.user.color = user.color ?? "#6366f1";
      return session;
    },
  },
  events: {
    /**
     * There is exactly one household. Anyone who clears the allowlist joins it,
     * creating it on the very first sign-in.
     */
    async createUser({ user }) {
      if (!user.id) return;

      const existing = await db.select().from(households).limit(1);
      const household =
        existing[0] ??
        (
          await db
            .insert(households)
            .values({ name: "Home", baseCurrency: env.APP_BASE_CURRENCY })
            .returning()
        )[0];

      if (!household) return;

      await db
        .update(users)
        .set({
          householdId: household.id,
          displayName: user.name ?? user.email ?? "Member",
        })
        .where(eq(users.id, user.id));
    },
  },
});
