/** UTC ISO-8601 with a `Z` suffix, matching REST `Date#toISOString()`. */
export function utcIso(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function utcIsoFields(object, keys) {
  if (!object || typeof object !== "object") return object;
  const next = { ...object };
  for (const key of keys) {
    if (next[key] != null && next[key] !== "") {
      const iso = utcIso(next[key]);
      if (iso) next[key] = iso;
    }
  }
  return next;
}
