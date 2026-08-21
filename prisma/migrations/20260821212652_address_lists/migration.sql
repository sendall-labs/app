-- CreateTable
CREATE TABLE "AddressList" (
    "id" TEXT NOT NULL,
    "ownerPublicKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressListEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressList_ownerPublicKey_idx" ON "AddressList"("ownerPublicKey");

-- CreateIndex
CREATE INDEX "AddressListEntry_listId_idx" ON "AddressListEntry"("listId");

-- AddForeignKey
ALTER TABLE "AddressListEntry" ADD CONSTRAINT "AddressListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "AddressList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
