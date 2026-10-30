-- Pet Sitter Plus — Phase 1 new tables
-- Boarding / dog walking / in-home services, CCTV cameras + booking-window
-- grants, GPS walks and trail points.

-- ---------------------------------------------------------------------------
-- services — one priced offering per sitter × type × mode × duration
-- boarding: mode NULL, price per night
-- dog_walking: per_walk | duration (30/45/60 min)
-- in_home: visit | overnight
-- ---------------------------------------------------------------------------
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitter_id uuid NOT NULL REFERENCES public.sitter_profiles (user_id) ON DELETE CASCADE,
  type text NOT NULL,
  mode text,
  duration_minutes integer,
  price_amount numeric(12, 2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'THB',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_type_check CHECK (type IN ('boarding', 'dog_walking', 'in_home')),
  CONSTRAINT services_mode_check CHECK (
    (type = 'boarding' AND mode IS NULL AND duration_minutes IS NULL)
    OR (type = 'dog_walking' AND mode IN ('per_walk', 'duration'))
    OR (type = 'in_home' AND mode IN ('visit', 'overnight') AND duration_minutes IS NULL)
  ),
  CONSTRAINT services_duration_minutes_check CHECK (
    duration_minutes IS NULL OR duration_minutes IN (30, 45, 60)
  ),
  CONSTRAINT services_duration_mode_check CHECK (
    (mode = 'duration' AND duration_minutes IS NOT NULL)
    OR (mode IS DISTINCT FROM 'duration' AND duration_minutes IS NULL)
  ),
  CONSTRAINT services_price_check CHECK (price_amount >= 0)
);

CREATE UNIQUE INDEX services_sitter_offering_unique
  ON public.services (sitter_id, type, mode, duration_minutes)
  NULLS NOT DISTINCT;

CREATE INDEX services_sitter_id_idx ON public.services (sitter_id);

ALTER TABLE public.bookings
  ADD COLUMN service_id uuid REFERENCES public.services (id);

CREATE INDEX bookings_service_id_idx
  ON public.bookings (service_id)
  WHERE service_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- cameras
-- ponytail: venue_id is a free uuid (no venues table). Sitters are one-home
-- today; add a venues table if a sitter has multiple locations.
-- stream_url is private (HLS/WebRTC); API issues short-lived signed URLs later.
-- ---------------------------------------------------------------------------
CREATE TABLE public.cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitter_id uuid NOT NULL REFERENCES public.sitter_profiles (user_id) ON DELETE CASCADE,
  venue_id uuid,
  name text NOT NULL,
  stream_url text,
  is_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cameras_status_check CHECK (status IN ('online', 'offline', 'reconnecting'))
);

CREATE INDEX cameras_sitter_id_idx ON public.cameras (sitter_id);

-- ---------------------------------------------------------------------------
-- camera_access_grants — one row per (booking, camera), clipped to booking
-- check-in/out. Owner must be the booking owner.
-- ---------------------------------------------------------------------------
CREATE TABLE public.camera_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  camera_id uuid NOT NULL REFERENCES public.cameras (id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT camera_access_grants_booking_camera_unique UNIQUE (booking_id, camera_id),
  CONSTRAINT camera_access_grants_window_check CHECK (valid_to > valid_from)
);

CREATE INDEX camera_access_grants_booking_id_idx
  ON public.camera_access_grants (booking_id);

CREATE INDEX camera_access_grants_owner_window_idx
  ON public.camera_access_grants (owner_id, valid_from, valid_to);

CREATE OR REPLACE FUNCTION public.enforce_camera_grant_booking_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  booking_owner uuid;
  booking_start timestamptz;
  booking_end timestamptz;
BEGIN
  SELECT
    owner_id,
    ((start_date + start_time) AT TIME ZONE 'Asia/Bangkok'),
    ((COALESCE(end_date, start_date) + end_time) AT TIME ZONE 'Asia/Bangkok')
  INTO booking_owner, booking_start, booking_end
  FROM public.bookings
  WHERE id = NEW.booking_id;

  IF booking_owner IS NULL THEN
    RAISE EXCEPTION 'camera_access_grants.booking_id does not exist';
  END IF;

  IF NEW.owner_id <> booking_owner THEN
    RAISE EXCEPTION 'camera_access_grants.owner_id must match bookings.owner_id';
  END IF;

  -- Compare as timestamps without time zone against the booking local slot.
  -- Grants may not start before check-in or end after check-out.
  IF NEW.valid_from < booking_start OR NEW.valid_to > booking_end THEN
    RAISE EXCEPTION 'camera_access_grants window must sit inside the booking window';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER camera_access_grants_booking_window
BEFORE INSERT OR UPDATE ON public.camera_access_grants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_camera_grant_booking_window();

-- ---------------------------------------------------------------------------
-- walks
-- ponytail: pet_ids is a bigint[] matching the walk spec. Split into walk_pets
-- if per-pet distance/notes are needed.
-- ---------------------------------------------------------------------------
CREATE TABLE public.walks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  walker_id uuid NOT NULL REFERENCES public.users (id),
  pet_ids bigint[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'scheduled',
  started_at timestamptz,
  ended_at timestamptz,
  distance_m numeric(10, 2) NOT NULL DEFAULT 0,
  duration_s integer NOT NULL DEFAULT 0,
  route_polyline text,
  notes text,
  photos text[] NOT NULL DEFAULT '{}',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT walks_status_check CHECK (status IN ('scheduled', 'live', 'paused', 'ended')),
  CONSTRAINT walks_times_check CHECK (
    ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at
  )
);

CREATE INDEX walks_booking_id_idx ON public.walks (booking_id);
CREATE INDEX walks_walker_id_idx ON public.walks (walker_id);

-- ---------------------------------------------------------------------------
-- walk_points — walker posts every 5–10s; indexed by walk + time
-- ---------------------------------------------------------------------------
CREATE TABLE public.walk_points (
  id bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  walk_id uuid NOT NULL REFERENCES public.walks (id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  speed double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT walk_points_lat_check CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT walk_points_lng_check CHECK (lng >= -180 AND lng <= 180)
);

CREATE INDEX walk_points_walk_id_recorded_at_idx
  ON public.walk_points (walk_id, recorded_at);
