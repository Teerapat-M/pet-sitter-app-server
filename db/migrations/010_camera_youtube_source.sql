-- Pet Sitter Plus — optional YouTube Live source per CCTV camera.
-- Projects Manager applies this; do not run against a live database from the app.
--
-- WebRTC stays the default. youtube_video_id is the 11-character video id only —
-- never a stream key, never a full URL.

ALTER TABLE public.cameras
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'webrtc',
  ADD COLUMN IF NOT EXISTS youtube_video_id text;

ALTER TABLE public.cameras DROP CONSTRAINT IF EXISTS cameras_source_check;
ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_source_check
  CHECK (source IN ('webrtc', 'youtube'));

ALTER TABLE public.cameras DROP CONSTRAINT IF EXISTS cameras_youtube_video_id_format_check;
ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_youtube_video_id_format_check
  CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');

ALTER TABLE public.cameras DROP CONSTRAINT IF EXISTS cameras_youtube_source_id_check;
ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_youtube_source_id_check
  CHECK (source <> 'youtube' OR youtube_video_id IS NOT NULL);

COMMENT ON COLUMN public.cameras.source IS
  'webrtc (default, venue device) or youtube (unlisted Live embed).';
COMMENT ON COLUMN public.cameras.youtube_video_id IS
  'YouTube video id (exactly 11 chars). Never a stream key or URL.';
