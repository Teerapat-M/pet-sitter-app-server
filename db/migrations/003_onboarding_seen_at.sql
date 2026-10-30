-- First-visit onboarding tour: persist "seen" on the user once logged in.
-- Client also stores a localStorage flag so the tour can stay skipped before auth
-- and be replayed from the menu (clears this timestamp).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_seen_at timestamptz;
