-- When a booking's check-in/out moves, clip camera_access_grants to the new
-- window. Grants with no remaining positive-length overlap are revoked.

CREATE OR REPLACE FUNCTION public.sync_camera_grants_to_booking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  booking_start timestamptz;
  booking_end timestamptz;
BEGIN
  booking_start := ((NEW.start_date + NEW.start_time) AT TIME ZONE 'Asia/Bangkok');
  booking_end := ((COALESCE(NEW.end_date, NEW.start_date) + NEW.end_time) AT TIME ZONE 'Asia/Bangkok');

  DELETE FROM public.camera_access_grants
  WHERE booking_id = NEW.id
    AND GREATEST(valid_from, booking_start) >= LEAST(valid_to, booking_end);

  UPDATE public.camera_access_grants
  SET
    valid_from = GREATEST(valid_from, booking_start),
    valid_to = LEAST(valid_to, booking_end)
  WHERE booking_id = NEW.id
    AND (valid_from < booking_start OR valid_to > booking_end);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_camera_grants ON public.bookings;

CREATE TRIGGER bookings_sync_camera_grants
AFTER UPDATE OF start_date, end_date, start_time, end_time ON public.bookings
FOR EACH ROW
WHEN (
  OLD.start_date IS DISTINCT FROM NEW.start_date
  OR OLD.end_date IS DISTINCT FROM NEW.end_date
  OR OLD.start_time IS DISTINCT FROM NEW.start_time
  OR OLD.end_time IS DISTINCT FROM NEW.end_time
)
EXECUTE FUNCTION public.sync_camera_grants_to_booking();
