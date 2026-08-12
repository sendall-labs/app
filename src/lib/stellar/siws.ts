import { Keypair, WebAuth } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase } from "./client";

const CHALLENGE_TIMEOUT_SECONDS = 300; // 5 minutes

function getServerKeypair(): Keypair {
  const secret = process.env.SEP10_SERVER_SECRET;
  if (!secret) throw new Error("SEP10_SERVER_SECRET is not set");
  return Keypair.fromSecret(secret);
}

function getHomeDomain(): string {
  const domain = process.env.NEXT_PUBLIC_HOME_DOMAIN;
  if (!domain) throw new Error("NEXT_PUBLIC_HOME_DOMAIN is not set");
  return domain;
}

/**
 * Builds a SEP-10 style login challenge for `clientPublicKey`. The
 * transaction is never submitted to the network — sequence 0, server
 * signed, client signs it back as proof of key ownership (Sign-In-With-
 * Stellar). Reuses the SEP-10 Web Auth standard rather than a bespoke
 * "sign this message" scheme.
 */
export function buildLoginChallenge(
  clientPublicKey: string,
  network: Network
): string {
  const passphrase = getNetworkPassphrase(network);
  return WebAuth.buildChallengeTx(
    getServerKeypair(),
    clientPublicKey,
    getHomeDomain(),
    CHALLENGE_TIMEOUT_SECONDS,
    passphrase,
    getHomeDomain()
  );
}

/**
 * Verifies a client-signed challenge and returns the authenticated
 * public key. Throws if the challenge is expired, malformed, signed by
 * the wrong domain, or not actually signed by the claimed client key.
 */
export function verifyLoginChallenge(
  signedChallengeXdr: string,
  network: Network
): string {
  const passphrase = getNetworkPassphrase(network);
  const serverPublicKey = getServerKeypair().publicKey();
  const homeDomain = getHomeDomain();

  const { clientAccountID } = WebAuth.readChallengeTx(
    signedChallengeXdr,
    serverPublicKey,
    passphrase,
    homeDomain,
    homeDomain
  );

  WebAuth.verifyChallengeTxSigners(
    signedChallengeXdr,
    serverPublicKey,
    passphrase,
    [clientAccountID],
    homeDomain,
    homeDomain
  );

  return clientAccountID;
}

