import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  // Turnstile (D-20): the venue's own ticketing rows, every column — nothing sealed lives here. Ticket codes are the
  // venue's door codes; `ticketSalt` on Event is what mints them, and it is the venue's too.
  { name: 'Event', rows: (tx, orgId) => tx.event.findMany({ where: { orgId } }) },
  { name: 'Pool', rows: (tx, orgId) => tx.pool.findMany({ where: { orgId } }) },
  { name: 'Tier', rows: (tx, orgId) => tx.tier.findMany({ where: { orgId } }) },
  { name: 'Section', rows: (tx, orgId) => tx.section.findMany({ where: { orgId } }) },
  { name: 'Seat', rows: (tx, orgId) => tx.seat.findMany({ where: { orgId } }) },
  { name: 'Hold', rows: (tx, orgId) => tx.hold.findMany({ where: { orgId } }) },
  { name: 'Payment', rows: (tx, orgId) => tx.payment.findMany({ where: { orgId } }) },
  { name: 'Order', rows: (tx, orgId) => tx.order.findMany({ where: { orgId } }) },
  { name: 'Ticket', rows: (tx, orgId) => tx.ticket.findMany({ where: { orgId } }) },
  { name: 'WaitlistEntry', rows: (tx, orgId) => tx.waitlistEntry.findMany({ where: { orgId } }) },
  { name: 'Refund', rows: (tx, orgId) => tx.refund.findMany({ where: { orgId } }) },
  { name: 'CommandLog', rows: (tx, orgId) => tx.commandLog.findMany({ where: { orgId } }) },
  { name: 'Customer', rows: (tx, orgId) => tx.customer.findMany({ where: { orgId } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {};
