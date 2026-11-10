-- Turnstile tables (D-20). The DDL above the marker is `prisma migrate diff --from-migrations --to-schema --script`
-- output; below it is hand-written: the D-9 CHAR(19) axis CHECKs and the non-negative money CHECKs (Prisma cannot say them;
-- migrate diff ignores CHECK constraints, so the schema-vs-migrations diff stays empty). Triggers (D-21): the next migration.


-- CreateEnum
CREATE TYPE "PoolKind" AS ENUM ('GA', 'RESERVED');

-- CreateEnum
CREATE TYPE "SeatState" AS ENUM ('OPEN', 'HELD', 'SOLD');

-- CreateEnum
CREATE TYPE "HoldKind" AS ENUM ('HOLD', 'OFFER');

-- CreateEnum
CREATE TYPE "HoldState" AS ENUM ('HELD', 'PAYING', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'PAY_FAILED', 'PAY_TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'SUCCEEDED_LATE');

-- CreateEnum
CREATE TYPE "TicketState" AS ENUM ('ISSUED', 'CHECKED_IN', 'REFUNDED');

-- CreateEnum
CREATE TYPE "EntryState" AS ENUM ('WAITING', 'OFFERED', 'FULFILLED', 'LEFT', 'CLOSED', 'CLOSED_OFF_SALE', 'OFFER_EXPIRED', 'OFFER_DECLINED', 'OFFER_PAY_FAILED');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('OK', 'REJECT');

-- DropForeignKey
ALTER TABLE "BillingAccount" DROP CONSTRAINT "BillingAccount_orgId_fkey";

-- DropTable
DROP TABLE "BillingAccount";

-- DropTable
DROP TABLE "StripeEvent";

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "timezoneLabel" TEXT NOT NULL,
    "startsAt" CHAR(19) NOT NULL,
    "doorsAt" CHAR(19) NOT NULL,
    "salesOpenAt" CHAR(19) NOT NULL,
    "salesCloseAt" CHAR(19) NOT NULL,
    "currency" TEXT NOT NULL,
    "ticketSalt" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "cancelledAt" CHAR(19),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "poolId" TEXT NOT NULL,
    "kind" "PoolKind" NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("eventId","poolId")
);

-- CreateTable
CREATE TABLE "Tier" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "tierId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "allotment" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "onSaleAt" CHAR(19) NOT NULL,
    "offSaleAt" CHAR(19) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("eventId","tierId")
);

-- CreateTable
CREATE TABLE "Section" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "sectionId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "rows" TEXT[],
    "seatsPerRow" INTEGER NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("eventId","sectionId")
);

-- CreateTable
CREATE TABLE "Seat" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "seatId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "tierId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "state" "SeatState" NOT NULL DEFAULT 'OPEN',
    "holdId" TEXT,
    "ticketId" TEXT,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("eventId","seatId")
);

-- CreateTable
CREATE TABLE "Hold" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "holdId" TEXT NOT NULL,
    "kind" "HoldKind" NOT NULL,
    "customer" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "seats" TEXT[],
    "state" "HoldState" NOT NULL DEFAULT 'HELD',
    "createdAt" CHAR(19) NOT NULL,
    "expiresAt" CHAR(19) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "paymentId" TEXT,
    "payStartedAt" CHAR(19),
    "payTimeoutAt" CHAR(19),
    "entryId" TEXT,
    "orderId" TEXT,
    "endedAt" CHAR(19),

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("eventId","holdId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "paymentId" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'PENDING',
    "startedAt" CHAR(19) NOT NULL,
    "endedAt" CHAR(19),
    "paymentIntentId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("eventId","paymentId")
);

-- CreateTable
CREATE TABLE "Order" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "orderId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "seats" TEXT[],
    "grossCents" INTEGER NOT NULL,
    "feesCents" INTEGER NOT NULL,
    "paymentId" TEXT NOT NULL,
    "confirmedAt" CHAR(19) NOT NULL,
    "tickets" TEXT[],
    "holdId" TEXT NOT NULL,
    "viaOffer" BOOLEAN NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("eventId","orderId")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "ticketId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "seat" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "state" "TicketState" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" CHAR(19) NOT NULL,
    "checkedInAt" CHAR(19),
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "refundedAt" CHAR(19),
    "code" TEXT NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("eventId","ticketId")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "entryId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "joinedAt" CHAR(19) NOT NULL,
    "state" "EntryState" NOT NULL DEFAULT 'WAITING',
    "offerId" TEXT,
    "offeredAt" CHAR(19),
    "endedAt" CHAR(19),
    "orderId" TEXT,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("eventId","entryId")
);

-- CreateTable
CREATE TABLE "Refund" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL DEFAULT '',
    "ticketId" TEXT NOT NULL DEFAULT '',
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "at" CHAR(19) NOT NULL,
    "stripeRefundId" TEXT,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("eventId","refundId")
);

-- CreateTable
CREATE TABLE "CommandLog" (
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "cmdId" TEXT NOT NULL,
    "at" CHAR(19) NOT NULL,
    "kind" TEXT NOT NULL,
    "customer" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "status" "CommandStatus" NOT NULL,
    "code" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "stripeEventId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandLog_pkey" PRIMARY KEY ("eventId","cmdId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "orgId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("orgId","customerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_orgId_eventKey_key" ON "Event"("orgId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommandLog_stripeEventId_key" ON "CommandLog"("stripeEventId");

-- CreateIndex
CREATE INDEX "CommandLog_eventId_at_idx" ON "CommandLog"("eventId", "at");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandLog" ADD CONSTRAINT "CommandLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- hand-written below (D-9, D-16): every axis instant is YYYY-MM-DDTHH:MM:SS; cents and counts are never negative.

ALTER TABLE "Event" ADD CONSTRAINT "Event_startsAt_axis" CHECK ("startsAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Event" ADD CONSTRAINT "Event_doorsAt_axis" CHECK ("doorsAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Event" ADD CONSTRAINT "Event_salesOpenAt_axis" CHECK ("salesOpenAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Event" ADD CONSTRAINT "Event_salesCloseAt_axis" CHECK ("salesCloseAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Event" ADD CONSTRAINT "Event_cancelledAt_axis" CHECK ("cancelledAt" IS NULL OR "cancelledAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Event" ADD CONSTRAINT "Event_sales_window" CHECK ("salesOpenAt" < "salesCloseAt");
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_capacity_nonneg" CHECK ("capacity" >= 0);
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_onSaleAt_axis" CHECK ("onSaleAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_offSaleAt_axis" CHECK ("offSaleAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_priceCents_nonneg" CHECK ("priceCents" >= 0);
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_allotment_nonneg" CHECK ("allotment" >= 0);
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_window_half_open" CHECK ("onSaleAt" < "offSaleAt");
ALTER TABLE "Section" ADD CONSTRAINT "Section_seatsPerRow_nonneg" CHECK ("seatsPerRow" >= 0);
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_num_nonneg" CHECK ("num" >= 0);
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_createdAt_axis" CHECK ("createdAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_expiresAt_axis" CHECK ("expiresAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_payStartedAt_axis" CHECK ("payStartedAt" IS NULL OR "payStartedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_payTimeoutAt_axis" CHECK ("payTimeoutAt" IS NULL OR "payTimeoutAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_endedAt_axis" CHECK ("endedAt" IS NULL OR "endedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_priceCents_nonneg" CHECK ("priceCents" >= 0);
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_feeCents_nonneg" CHECK ("feeCents" >= 0);
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_startedAt_axis" CHECK ("startedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_endedAt_axis" CHECK ("endedAt" IS NULL OR "endedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountCents_nonneg" CHECK ("amountCents" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_confirmedAt_axis" CHECK ("confirmedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Order" ADD CONSTRAINT "Order_grossCents_nonneg" CHECK ("grossCents" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_feesCents_nonneg" CHECK ("feesCents" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_issuedAt_axis" CHECK ("issuedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_checkedInAt_axis" CHECK ("checkedInAt" IS NULL OR "checkedInAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_refundedAt_axis" CHECK ("refundedAt" IS NULL OR "refundedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_priceCents_nonneg" CHECK ("priceCents" >= 0);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_feeCents_nonneg" CHECK ("feeCents" >= 0);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_refundedCents_nonneg" CHECK ("refundedCents" >= 0);
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_joinedAt_axis" CHECK ("joinedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_offeredAt_axis" CHECK ("offeredAt" IS NULL OR "offeredAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_endedAt_axis" CHECK ("endedAt" IS NULL OR "endedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_at_axis" CHECK ("at" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amountCents_nonneg" CHECK ("amountCents" >= 0);
ALTER TABLE "CommandLog" ADD CONSTRAINT "CommandLog_at_axis" CHECK ("at" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
