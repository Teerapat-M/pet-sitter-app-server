-- Pet Sitter Plus — Phase 3 booking columns and status.
-- Projects Manager applies this; do not run against a live database from the app.
--
-- Adds `completed` (keeps legacy `success`), duration units for walks/nights,
-- and in-home address fields. Overlap is enforced in the create transaction
-- (SELECT FOR UPDATE) rather than a gist exclusion: seeded boarding + walk
-- for the same sitter occupy the same window on purpose (walk a boarded dog).

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check CHECK (
    status IN (
      'waiting_confirm',
      'waiting_service',
      'in_service',
      'completed',
      'success',
      'cancelled'
    )
  );

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_duration_unit_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_duration_unit_check
  CHECK (duration_unit IN ('hours', 'Day', 'nights', 'minutes', 'walk'));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS owner_address text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS access_instructions text;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_booking_idx
  ON public.conversations (booking_id)
  WHERE booking_id IS NOT NULL;
