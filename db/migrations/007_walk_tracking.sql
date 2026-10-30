-- Pet Sitter Plus — Phase 4 GPS walk tracking.
-- Projects Manager applies this; do not run against a live database from the app.
--
-- One walk per booking (keep a live/paused row over an ended one), plus
-- LISTEN/NOTIFY so the existing SSE stack can fan out live points.

-- Keep one walk per booking_id so start is idempotent and history is a
-- single trail. Prefer live, then paused, then the newest ended row.
DELETE FROM public.walks AS w
WHERE w.id <> (
  SELECT w2.id
  FROM public.walks AS w2
  WHERE w2.booking_id = w.booking_id
  ORDER BY
    CASE w2.status
      WHEN 'live' THEN 0
      WHEN 'paused' THEN 1
      WHEN 'ended' THEN 2
      ELSE 3
    END,
    w2.started_at DESC NULLS LAST,
    w2.created_at DESC,
    w2.id DESC
  LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS walks_one_per_booking_idx
  ON public.walks (booking_id);

CREATE OR REPLACE FUNCTION public.notify_walk_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payload jsonb;
  booking_uuid uuid;
  owner_uuid uuid;
  sitter_uuid uuid;
  walk_status text;
BEGIN
  IF TG_TABLE_NAME = 'walk_points' THEN
    SELECT walks.booking_id, walks.status, bookings.owner_id, bookings.sitter_id
      INTO booking_uuid, walk_status, owner_uuid, sitter_uuid
    FROM public.walks
    INNER JOIN public.bookings ON bookings.id = walks.booking_id
    WHERE walks.id = NEW.walk_id;

    payload := jsonb_build_object(
      'type', 'point',
      'walkId', NEW.walk_id,
      'bookingId', booking_uuid,
      'ownerId', owner_uuid,
      'sitterId', sitter_uuid,
      'walkStatus', walk_status,
      'point', jsonb_build_object(
        'id', NEW.id,
        'lat', NEW.lat,
        'lng', NEW.lng,
        'accuracy', NEW.accuracy,
        'recordedAt', NEW.recorded_at
      )
    );
  ELSE
    SELECT bookings.owner_id, bookings.sitter_id
      INTO owner_uuid, sitter_uuid
    FROM public.bookings
    WHERE bookings.id = NEW.booking_id;

    payload := jsonb_build_object(
      'type', CASE
        WHEN NEW.status = 'live' THEN 'started'
        WHEN NEW.status = 'ended' THEN 'ended'
        ELSE NEW.status
      END,
      'walkId', NEW.id,
      'bookingId', NEW.booking_id,
      'ownerId', owner_uuid,
      'sitterId', sitter_uuid,
      'walkStatus', NEW.status,
      'startedAt', NEW.started_at,
      'endedAt', NEW.ended_at,
      'distanceM', NEW.distance_m,
      'durationS', NEW.duration_s
    );
  END IF;

  PERFORM pg_notify('walk_events', payload::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS walk_points_notify ON public.walk_points;
CREATE TRIGGER walk_points_notify
AFTER INSERT ON public.walk_points
FOR EACH ROW
EXECUTE FUNCTION public.notify_walk_event();

DROP TRIGGER IF EXISTS walks_status_notify ON public.walks;
CREATE TRIGGER walks_status_notify
AFTER INSERT OR UPDATE OF status, ended_at
ON public.walks
FOR EACH ROW
EXECUTE FUNCTION public.notify_walk_event();
