import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const REFRESH_COOKIE = "sendall_refresh";
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type Db = typeof prisma | Prisma.TransactionClient;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function createRow(
  db: Db,
  ownerPublicKey: string
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await db.refreshToken.create({
    data: { ownerPublicKey, tokenHash: hashToken(raw), expiresAt },
  });
  return { raw, expiresAt };
}

/** Issues a fresh refresh token row for a newly-verified login. */
export async function issueRefreshToken(
  ownerPublicKey: string
): Promise<{ raw: string; expiresAt: Date }> {
  return createRow(prisma, ownerPublicKey);
}

/**
 * Consumes a refresh token and issues a new one in its place (rotation) —
 * each refresh token is single-use. Returns null if the token is unknown,
 * expired, or already revoked/rotated, so the caller can require a fresh
 * wallet sign-in instead of silently extending a dead session.
 */
export async function rotateRefreshToken(
  raw: string
): Promise<{ ownerPublicKey: string; raw: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(raw);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      return null;
    }

    await tx.refreshToken.delete({ where: { id: existing.id } });
    const next = await createRow(tx, existing.ownerPublicKey);
    return { ownerPublicKey: existing.ownerPublicKey, ...next };
  });
}

/** Revokes a refresh token so it can no longer be used — called on logout. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
}
