import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { parseAddressList } from "@/lib/csv/parseAddressList";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { listId } = await params;
  const list = await prisma.addressList.findFirst({
    where: { id: listId, ownerPublicKey: publicKey },
    include: { entries: { orderBy: { rowIndex: "asc" } } },
  });
  if (!list) return NextResponse.json({ error: "Address list not found" }, { status: 404 });

  return NextResponse.json({ list });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  // Provided -> replace every entry with a fresh parse of this text.
  // Omitted -> only the name changes.
  text: z.string().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { name, text } = parsed.data;

  const { listId } = await params;
  const existing = await prisma.addressList.findFirst({ where: { id: listId, ownerPublicKey: publicKey } });
  if (!existing) return NextResponse.json({ error: "Address list not found" }, { status: 404 });

  let parseErrors: { rowIndex: number; message: string }[] = [];
  let truncated = false;

  const list = await prisma.$transaction(async (tx) => {
    if (text !== undefined) {
      const result = parseAddressList(text);
      parseErrors = result.errors;
      truncated = result.truncated;
      await tx.addressListEntry.deleteMany({ where: { listId } });
      if (result.rows.length > 0) {
        await tx.addressListEntry.createMany({
          data: result.rows.map((r) => ({
            listId,
            rowIndex: r.rowIndex,
            name: r.name,
            address: r.address,
            addressValid: r.addressValid,
          })),
        });
      }
    }

    return tx.addressList.update({
      where: { id: listId },
      data: { ...(name !== undefined ? { name } : {}) },
      include: { entries: { orderBy: { rowIndex: "asc" } } },
    });
  });

  return NextResponse.json({ list, parseErrors, truncated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { listId } = await params;
  const { count } = await prisma.addressList.deleteMany({ where: { id: listId, ownerPublicKey: publicKey } });
  if (count === 0) return NextResponse.json({ error: "Address list not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
