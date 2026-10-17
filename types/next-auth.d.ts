import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      householdId: string | null;
      displayName: string | null;
      color: string;
    } & DefaultSession["user"];
  }

  interface User {
    householdId?: string | null;
    displayName?: string | null;
    color?: string;
  }
}
