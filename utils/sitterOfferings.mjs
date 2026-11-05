import { httpError } from "./httpError.mjs";
import { SERVICE_TYPES, WALK_DURATIONS } from "./servicePricing.mjs";

const STAY_WITH_PET = "stay_with_pet";

export function offeringKey(row) {
  const type = row.type;
  const mode = row.mode ?? null;
  const duration = row.durationMinutes ?? row.duration_minutes ?? null;
  return `${type}|${mode ?? ""}|${duration ?? ""}`;
}

export function mapOfferingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    mode: row.mode ?? null,
    durationMinutes: row.duration_minutes ?? row.durationMinutes ?? null,
    priceAmount: Number(row.price_amount ?? row.priceAmount),
    currency: row.currency ?? "THB",
    isActive: row.is_active !== false && row.isActive !== false,
  };
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePrice(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    throw httpError(400, "priceAmount must be a number ≥ 0");
  }
  return amount;
}

function parseCurrency(raw) {
  if (raw == null || raw === "") return "THB";
  const currency = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw httpError(400, "currency must be a 3-letter code");
  }
  return currency;
}

/** Boarding / dog walking / in-home; `stay_with_pet` is an in_home overnight alias. */
export function parseOfferingInput(raw) {
  if (!raw || typeof raw !== "object") {
    throw httpError(400, "each offering must be an object");
  }
  const rawType = trimString(raw.type ?? raw.serviceType);
  let type = rawType === STAY_WITH_PET ? "in_home" : rawType;
  if (!SERVICE_TYPES.has(type)) {
    throw httpError(
      400,
      "type must be boarding, dog_walking, in_home, or stay_with_pet"
    );
  }

  let mode = trimString(raw.mode) || null;
  if (rawType === STAY_WITH_PET) {
    if (mode && mode !== "overnight") {
      throw httpError(400, "stay_with_pet is overnight only");
    }
    mode = "overnight";
  }

  const durationRaw = raw.durationMinutes ?? raw.duration_minutes;
  let durationMinutes =
    durationRaw == null || durationRaw === "" ? null : Number(durationRaw);

  if (type === "boarding") {
    if (mode) throw httpError(400, "boarding does not take a mode");
    if (durationMinutes != null) {
      throw httpError(400, "boarding does not take durationMinutes");
    }
    mode = null;
    durationMinutes = null;
  } else if (type === "dog_walking") {
    if (!mode) {
      mode = durationMinutes != null ? "duration" : "per_walk";
    }
    if (mode !== "per_walk" && mode !== "duration") {
      throw httpError(400, "dog_walking mode must be per_walk or duration");
    }
    if (mode === "duration") {
      if (!WALK_DURATIONS.has(durationMinutes)) {
        throw httpError(400, "durationMinutes must be 30, 45, or 60");
      }
    } else {
      durationMinutes = null;
    }
  } else {
    if (mode !== "visit" && mode !== "overnight") {
      throw httpError(400, "in_home mode must be visit or overnight");
    }
    durationMinutes = null;
  }

  const isActive =
    raw.isActive ?? raw.is_active;
  return {
    type,
    mode,
    durationMinutes,
    priceAmount: parsePrice(raw.priceAmount ?? raw.price_amount),
    currency: parseCurrency(raw.currency),
    isActive: isActive == null ? true : Boolean(isActive),
  };
}

export function parseOfferingsBody(body) {
  const list = body?.offerings ?? body?.services;
  if (!Array.isArray(list)) {
    throw httpError(400, "offerings must be an array");
  }
  if (list.length > 12) {
    throw httpError(400, "at most 12 offerings");
  }
  const parsed = list.map(parseOfferingInput);
  const seen = new Set();
  for (const item of parsed) {
    const key = offeringKey(item);
    if (seen.has(key)) {
      throw httpError(400, "duplicate offering type/mode/duration");
    }
    seen.add(key);
  }
  return parsed;
}

export function planOfferingUpsert(existingRows, incoming) {
  const byKey = new Map(
    (existingRows ?? []).map((row) => [offeringKey(mapOfferingRow(row)), row])
  );
  const inserts = [];
  const updates = [];
  const keepIds = new Set();
  for (const item of incoming) {
    const found = byKey.get(offeringKey(item));
    if (found) {
      updates.push({ id: found.id, ...item });
      keepIds.add(found.id);
    } else {
      inserts.push(item);
    }
  }
  const deactivateIds = (existingRows ?? [])
    .map((row) => row.id)
    .filter((id) => !keepIds.has(id));
  return { inserts, updates, deactivateIds };
}
