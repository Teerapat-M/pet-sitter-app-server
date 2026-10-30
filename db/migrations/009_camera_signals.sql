-- Pet Sitter Plus — Phase 5 signalling payloads (NOTIFY ref).
-- Projects Manager applies this; do not run against a live database from the app.
--
-- Chromium video+audio SDP is ~6KB+; pg_notify is capped at 8000 UTF-8 bytes.
-- Store the full offer/answer/ICE body here and NOTIFY camera_events with the
-- row id only. The LISTEN handler loads the row and relays it over SSE.
-- Rows older than 5 minutes are deleted (on insert, and by the camera watch).

CREATE TABLE IF NOT EXISTS public.camera_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  camera_id uuid NOT NULL REFERENCES public.cameras (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS camera_signals_created_at_idx
  ON public.camera_signals (created_at);
