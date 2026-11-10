-- Turnstile guards (D-21, D-29): hand-written, nothing here is in prisma/schema (migrate diff ignores triggers).
--
-- 1. Append-only: CommandLog, Order — UPDATE and DELETE refused. Refund — DELETE refused; the one UPDATE admitted sets
--    stripeRefundId from NULL (the provider's id when the refund call returns, D-23) with every other column unchanged.
-- 2. Transition guards on Hold, Payment, Ticket, Seat, WaitlistEntry: DELETE refused; an UPDATE must move `state`
--    along one of the brief's transitions (§2), listed as the trigger's arguments (a same-state entry such as Seat
--    HELD>HELD is admitted only when the row changes); every transition needs a
--    CommandLog row of the same command in the same transaction (turnstile.cmd_id, set transaction-local by the
--    cast path before it writes; the CommandLog row is written first).
-- TRUNCATE is left alone (row triggers do not fire on it) so tests can empty the tables, as the foundation's audit
-- trigger does. Shape after Quorum quorum_init (quorum_append_only, quorum_meeting_guard).

CREATE FUNCTION turnstile_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (D-21)', TG_TABLE_NAME;
END $$;

CREATE TRIGGER "CommandLog_append_only" BEFORE UPDATE OR DELETE ON "CommandLog" FOR EACH ROW EXECUTE FUNCTION turnstile_append_only();
CREATE TRIGGER "Order_append_only"      BEFORE UPDATE OR DELETE ON "Order"      FOR EACH ROW EXECUTE FUNCTION turnstile_append_only();

CREATE FUNCTION turnstile_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund is append-only (D-21)';
  END IF;
  IF OLD."stripeRefundId" IS NOT NULL OR NEW."stripeRefundId" IS NULL
     OR row(NEW."orgId", NEW."eventId", NEW."refundId", NEW."orderId", NEW."ticketId", NEW."paymentId", NEW."amountCents", NEW."reason", NEW."at")
        IS DISTINCT FROM row(OLD."orgId", OLD."eventId", OLD."refundId", OLD."orderId", OLD."ticketId", OLD."paymentId", OLD."amountCents", OLD."reason", OLD."at") THEN
    RAISE EXCEPTION 'Refund % is append-only; only stripeRefundId NULL -> value is written, once (D-21, D-23)', OLD."refundId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Refund_guard" BEFORE UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION turnstile_refund_guard();

-- One function, five triggers: the allowed transitions are the trigger's arguments as 'FROM>TO'.
CREATE FUNCTION turnstile_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cmd TEXT := nullif(current_setting('turnstile.cmd_id', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted (D-21)', TG_TABLE_NAME;
  END IF;
  IF NOT ((OLD.state::text || '>' || NEW.state::text) = ANY (TG_ARGV)) OR (OLD.state = NEW.state AND OLD = NEW) THEN
    RAISE EXCEPTION '% %: % -> % is not a transition (D-21)', TG_TABLE_NAME, OLD."eventId", OLD.state, NEW.state;
  END IF;
  IF cmd IS NULL OR NOT EXISTS (SELECT 1 FROM "CommandLog" c WHERE c."eventId" = NEW."eventId" AND c."cmdId" = cmd) THEN
    RAISE EXCEPTION '% %: % -> % without a CommandLog row in this transaction (D-21)', TG_TABLE_NAME, OLD."eventId", OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Hold_guard" BEFORE UPDATE OR DELETE ON "Hold" FOR EACH ROW
  EXECUTE FUNCTION turnstile_transition_guard('HELD>PAYING', 'HELD>EXPIRED', 'HELD>RELEASED', 'HELD>CANCELLED', 'PAYING>CONFIRMED', 'PAYING>PAY_FAILED', 'PAYING>PAY_TIMEOUT', 'PAYING>CANCELLED');
CREATE TRIGGER "Payment_guard" BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW
  EXECUTE FUNCTION turnstile_transition_guard('PENDING>SUCCEEDED', 'PENDING>FAILED', 'PENDING>SUCCEEDED_LATE');
CREATE TRIGGER "Ticket_guard" BEFORE UPDATE OR DELETE ON "Ticket" FOR EACH ROW
  EXECUTE FUNCTION turnstile_transition_guard('ISSUED>CHECKED_IN', 'ISSUED>REFUNDED', 'CHECKED_IN>REFUNDED');
-- Seat composites through OPEN inside one command (the delta writes the end state of the tick): HELD>HELD is a seat
-- freed by an expiry or release and re-held in the same tick (the next waitlist head, or the command at the expiry
-- second; the row must differ, i.e. a new holdId); SOLD>HELD is a refund whose freed seat the waitlist fill offers
-- in the same tick (R-5). Both passed through OPEN; the CommandLog row of that command is the record of it.
CREATE TRIGGER "Seat_guard" BEFORE UPDATE OR DELETE ON "Seat" FOR EACH ROW
  EXECUTE FUNCTION turnstile_transition_guard('OPEN>HELD', 'HELD>OPEN', 'HELD>SOLD', 'SOLD>OPEN', 'HELD>HELD', 'SOLD>HELD');
CREATE TRIGGER "WaitlistEntry_guard" BEFORE UPDATE OR DELETE ON "WaitlistEntry" FOR EACH ROW
  EXECUTE FUNCTION turnstile_transition_guard('WAITING>OFFERED', 'WAITING>LEFT', 'WAITING>CLOSED', 'WAITING>CLOSED_OFF_SALE', 'OFFERED>FULFILLED', 'OFFERED>OFFER_EXPIRED', 'OFFERED>OFFER_DECLINED', 'OFFERED>OFFER_PAY_FAILED', 'OFFERED>LEFT', 'OFFERED>CLOSED');
