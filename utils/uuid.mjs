import { httpError } from "./httpError.mjs";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_RE.test(String(value ?? ""));
}

export function requireUuid(value, field = "id") {
  if (!isUuid(value)) {
    throw httpError(400, `Invalid ${field}`);
  }
  return String(value);
}
