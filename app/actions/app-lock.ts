"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/db";
import { users, webauthnCredentials } from "@/db/schema";
import {
  consumeChallenge,
  getAppLockState,
  guessDeviceLabel,
  isAuthenticationResponse,
  isRegistrationResponse,
  issueChallenge,
  listCredentials,
  relyingParty,
  setSessionUnlocked,
} from "@/lib/app-lock";
import { ActionError, authAction, authActionAllowLocked } from "@/lib/safe-action";

/**
 * Face ID app lock: register a passkey, unlock with it, lock, turn it off.
 *
 * Registering and disabling go through `authAction`, so they need an unlocked
 * session — otherwise anyone holding the locked phone could add their own face
 * or switch the lock off. Unlocking and locking are the only actions a locked
 * session may call, through the separate `authActionAllowLocked` client.
 */

const registrationResponse = z.custom<RegistrationResponseJSON>(
  isRegistrationResponse,
  "passkeyFailed",
);
const authenticationResponse = z.custom<AuthenticationResponseJSON>(
  isAuthenticationResponse,
  "unlockFailed",
);

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/** Step one of turning the lock on (or adding another device). */
export const getPasskeyRegistrationOptions = authAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const { rpID } = await relyingParty();
    const existing = await listCredentials(ctx.user.id);

    const options = await generateRegistrationOptions({
      rpName: "Ledger",
      rpID,
      userName: ctx.user.email,
      userDisplayName: ctx.user.name,
      // Stable per user, so re-registering on the same device replaces the
      // passkey rather than piling up a second one for the same account.
      userID: new TextEncoder().encode(ctx.user.id),
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports ?? [],
      })),
      authenticatorSelection: {
        // Face ID / Touch ID on this device — not a security key, not a phone
        // across the room. The lock is about who is holding *this* device.
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
    });

    await issueChallenge("register", ctx.user.id, options.challenge);
    return { options };
  });

/**
 * Step two: verify the new passkey, store it, switch the lock on, and count
 * this session as unlocked — the user has just proved their face to set it up.
 */
export const verifyPasskeyRegistration = authAction
  .inputSchema(z.object({ response: registrationResponse }))
  .action(async ({ parsedInput, ctx }) => {
    const challenge = await consumeChallenge("register", ctx.user.id);
    if (challenge === null) throw new ActionError("passkeyExpired");

    const { rpID, origins } = await relyingParty();

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsedInput.response,
        expectedChallenge: challenge,
        expectedOrigin: [...origins],
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      console.error("[app-lock] registration", error);
      throw new ActionError("passkeyFailed");
    }

    if (!verification.verified) throw new ActionError("passkeyFailed");
    const { credential } = verification.registrationInfo;

    await db.transaction(async (tx) => {
      await tx
        .insert(webauthnCredentials)
        .values({
          userId: ctx.user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports ?? null,
          deviceLabel: await guessDeviceLabel(),
        })
        .onConflictDoNothing({ target: webauthnCredentials.credentialId });

      await tx
        .update(users)
        .set({ appLockEnabled: true })
        .where(eq(users.id, ctx.user.id));
    });

    await setSessionUnlocked(ctx.user.id, true);
    revalidatePath("/", "layout");
    return { ok: true as const };
  });

/** Step one of unlocking: a challenge for this user's passkeys. */
export const getUnlockOptions = authActionAllowLocked
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const credentials = await listCredentials(ctx.user.id);
    if (credentials.length === 0) throw new ActionError("noPasskeys");

    const { rpID } = await relyingParty();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports ?? [],
      })),
    });

    await issueChallenge("unlock", ctx.user.id, options.challenge);
    return { options };
  });

/**
 * Step two: check the assertion against the stored public key, advance the
 * signature counter, and mark this session unlocked.
 */
export const verifyUnlock = authActionAllowLocked
  .inputSchema(z.object({ response: authenticationResponse }))
  .action(async ({ parsedInput, ctx }) => {
    const challenge = await consumeChallenge("unlock", ctx.user.id);
    if (challenge === null) throw new ActionError("passkeyExpired");

    const [stored] = await db
      .select()
      .from(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.userId, ctx.user.id),
          eq(webauthnCredentials.credentialId, parsedInput.response.id),
        ),
      )
      .limit(1);
    if (!stored) throw new ActionError("unlockFailed");

    const { rpID, origins } = await relyingParty();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: parsedInput.response,
        expectedChallenge: challenge,
        expectedOrigin: [...origins],
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: fromBase64url(stored.publicKey),
          counter: stored.counter,
          transports: stored.transports ?? [],
        },
      });
    } catch (error) {
      console.error("[app-lock] unlock", error);
      throw new ActionError("unlockFailed");
    }

    if (!verification.verified) throw new ActionError("unlockFailed");

    await db
      .update(webauthnCredentials)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(webauthnCredentials.id, stored.id));

    await setSessionUnlocked(ctx.user.id, true);
    revalidatePath("/", "layout");
    return { ok: true as const };
  });

/**
 * Turns the lock off and forgets every passkey. Only from an unlocked session:
 * `authAction` already refuses a locked one, and the explicit check says so
 * where a reader will look for it.
 */
export const disableAppLock = authAction
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const state = await getAppLockState();
    if (state.enabled && state.locked) throw new ActionError("appLocked");

    await db.transaction(async (tx) => {
      await tx
        .delete(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, ctx.user.id));
      await tx
        .update(users)
        .set({ appLockEnabled: false })
        .where(eq(users.id, ctx.user.id));
    });

    revalidatePath("/", "layout");
    return { ok: true as const };
  });

/**
 * Locks this session. The client calls it on a cold start and when it comes
 * back after inactivity; it is harmless when the lock is off.
 */
export const lockApp = authActionAllowLocked
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    await setSessionUnlocked(ctx.user.id, false);
    return { ok: true as const };
  });

/** For the client's lock screen: whether to show it right now. */
export const getAppLockStatus = authActionAllowLocked
  .inputSchema(z.object({}))
  .action(async () => getAppLockState());
