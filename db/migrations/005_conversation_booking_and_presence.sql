-- Link a conversation to an optional booking, and persist user presence.
-- Projects Manager applies this; do not run against a live database from the app.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_booking_id_idx
  ON public.conversations (booking_id)
  WHERE booking_id IS NOT NULL;
