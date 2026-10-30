import { httpError } from "./httpError.mjs";

/** true = stamp now; false = clear (replay from the menu). */
export function parseOnboardingSeen(body) {
  const seen = body?.seen ?? body?.onboardingSeen;
  if (seen === true || seen === "true") return true;
  if (seen === false || seen === "false") return false;

  if (body?.onboardingSeenAt === null || body?.onboarding_seen_at === null) {
    return false;
  }

  throw httpError(400, "seen must be true or false");
}
