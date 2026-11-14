-- D-35: the per-event clock. The server's "now" for this event is axisNow(wall clock) + clockOffsetSeconds, on the
-- axis (D-9). Staff set it; every cast and every screen reads it. Stamping keeps the CommandLog in (at, cmd_id) order
-- whatever the offset, so the offset can only move what the next command is stamped with, never a stored row.
ALTER TABLE "Event" ADD COLUMN "clockOffsetSeconds" INTEGER NOT NULL DEFAULT 0;
