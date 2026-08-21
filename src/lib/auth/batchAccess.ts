import { getSessionPublicKey } from "./requireSession";
import { peekAnonId } from "./requireAnonSession";
import type { Prisma } from "@/generated/prisma/client";

export type BatchAccess = { publicKey: string | null; anonId: string | null };

/**
 * Resolves who's allowed to touch a batch on this request: an authenticated
 * wallet session takes priority; otherwise falls back to the anonymous
 * session cookie (a wallet-less visitor working on a draft). Never mints a
 * new anon id here — `peekAnonId` only reads, so a visitor with neither
 * cookie simply has no access to anything (not "access to nothing yet
 * matched by a fresh id").
 */
export async function resolveBatchAccess(): Promise<BatchAccess> {
  const publicKey = await getSessionPublicKey();
  const anonId = publicKey ? null : await peekAnonId();
  return { publicKey, anonId };
}

/** Prisma `where` fragment scoping a batch query to the resolved access. */
export function batchAccessWhere({ publicKey, anonId }: BatchAccess): Prisma.BatchWhereInput {
  const or: Prisma.BatchWhereInput[] = [];
  if (publicKey) or.push({ ownerPublicKey: publicKey });
  if (anonId) or.push({ anonId });
  // Neither cookie present: match nothing rather than every batch.
  return or.length > 0 ? { OR: or } : { id: { equals: "__no_access__" } };
}
