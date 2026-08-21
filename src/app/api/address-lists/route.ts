import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { parseAddressList } from "@/lib/csv/parseAddressList";

export async function GET() {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const lists = await prisma.addressList.findMany({
    where: { ownerPublicKey: publicKey },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });

  return NextResponse.json({ lists });
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  text: z.string().optional(),
});

export async function POST(request: Request) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { name, text } = parsed.data;

  const { rows, errors, truncated } = text ? parseAddressList(text) : { rows: [], errors: [], truncated: false };

  const list = await prisma.addressList.create({
    data: {
      ownerPublicKey: publicKey,
      name,
      entries: {
        create: rows.map((r) => ({
          rowIndex: r.rowIndex,
          name: r.name,
          address: r.address,
          addressValid: r.addressValid,
        })),
      },
    },
    include: { entries: true, _count: { select: { entries: true } } },
  });

  return NextResponse.json({ list, parseErrors: errors, truncated });
}
