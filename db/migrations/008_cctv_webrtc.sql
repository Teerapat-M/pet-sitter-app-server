-- Pet Sitter Plus — Phase 5 CCTV (browser WebRTC signalling).
-- Projects Manager applies this; do not run against a live database from the app.
--
-- cameras.status / is_enabled / last_seen_at already exist from 002.
-- This migration adds LISTEN/NOTIFY for camera:status and auto-creates
-- camera_access_grants for boarding bookings (window = check-in..check-out).

CREATE INDEX IF NOT EXISTS cameras_status_last_seen_at_idx
  ON public.cameras (status, last_seen_at);

CREATE INDEX IF NOT EXISTS cameras_venue_id_idx
  ON public.cameras (venue_id)
  WHERE venue_id IS NOT NULL;

-- Optional per-home tag (no venues table). Null = sitter's default home.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS venue_id uuid;

CREATE OR REPLACE FUNCTION public.notify_camera_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', 'camera:status',
    'cameraId', NEW.id,
    'sitterId', NEW.sitter_id,
    'venueId', NEW.venue_id,
    'name', NEW.name,
    'status', NEW.status,
    'isEnabled', NEW.is_enabled,
    'lastSeenAt', NEW.last_seen_at
  );
  PERFORM pg_notify('camera_events', payload::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cameras_status_notify ON public.cameras;
CREATE TRIGGER cameras_status_notify
AFTER INSERT OR UPDATE OF status, is_enabled
ON public.cameras
FOR EACH ROW
EXECUTE FUNCTION public.notify_camera_event();

CREATE OR REPLACE FUNCTION public.ensure_camera_grants_for_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
BEGIN
  SELECT
    b.id,
    b.owner_id,
    b.sitter_id,
    b.status,
    b.duration_unit,
    b.venue_id,
    s.type AS service_type,
    ((b.start_date + b.start_time) AT TIME ZONE 'Asia/Bangkok') AS booking_start,
    ((COALESCE(b.end_date, b.start_date) + b.end_time) AT TIME ZONE 'Asia/Bangkok') AS booking_end
  INTO rec
  FROM public.bookings b
  LEFT JOIN public.services s ON s.id = b.service_id
  WHERE b.id = p_booking_id;

  IF rec.id IS NULL THEN
    RETURN;
  END IF;

  IF rec.status IN ('cancelled', 'completed') THEN
    RETURN;
  END IF;

  IF NOT (
    rec.service_type = 'boarding'
    OR (rec.service_type IS NULL AND rec.duration_unit IN ('nights', 'Day'))
  ) THEN
    RETURN;
  END IF;

  IF rec.booking_end <= rec.booking_start THEN
    RETURN;
  END IF;

  INSERT INTO public.camera_access_grants (
    booking_id, owner_id, camera_id, valid_from, valid_to
  )
  SELECT rec.id, rec.owner_id, c.id, rec.booking_start, rec.booking_end
  FROM public.cameras c
  WHERE c.sitter_id = rec.sitter_id
    AND c.venue_id IS NOT DISTINCT FROM rec.venue_id
  ON CONFLICT (booking_id, camera_id) DO UPDATE SET
    valid_from = EXCLUDED.valid_from,
    valid_to = EXCLUDED.valid_to;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_ensure_camera_grants_for_booking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.ensure_camera_grants_for_booking(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_ensure_camera_grants ON public.bookings;
CREATE TRIGGER bookings_ensure_camera_grants
AFTER INSERT OR UPDATE OF status, service_id, venue_id, start_date, end_date, start_time, end_time
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trg_ensure_camera_grants_for_booking();

CREATE OR REPLACE FUNCTION public.trg_ensure_camera_grants_for_camera()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  booking_row record;
BEGIN
  FOR booking_row IN
    SELECT b.id
    FROM public.bookings b
    LEFT JOIN public.services s ON s.id = b.service_id
    WHERE b.sitter_id = NEW.sitter_id
      AND b.status NOT IN ('cancelled', 'completed')
      AND (
        s.type = 'boarding'
        OR (s.type IS NULL AND b.duration_unit IN ('nights', 'Day'))
      )
  LOOP
    PERFORM public.ensure_camera_grants_for_booking(booking_row.id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cameras_ensure_grants ON public.cameras;
CREATE TRIGGER cameras_ensure_grants
AFTER INSERT ON public.cameras
FOR EACH ROW
EXECUTE FUNCTION public.trg_ensure_camera_grants_for_camera();

-- Idempotent backfill: in-service boarding stays that already exist.
DO $$
DECLARE
  booking_row record;
BEGIN
  FOR booking_row IN
    SELECT b.id
    FROM public.bookings b
    LEFT JOIN public.services s ON s.id = b.service_id
    WHERE b.status = 'in_service'
      AND (
        s.type = 'boarding'
        OR (s.type IS NULL AND b.duration_unit IN ('nights', 'Day'))
      )
  LOOP
    PERFORM public.ensure_camera_grants_for_booking(booking_row.id);
  END LOOP;
END
$$;
