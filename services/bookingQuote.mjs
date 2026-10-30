import {
  doBookingsOverlap,
  isManyDayBooking,
  resolveBookingDateRange,
  resolveBookingPricing,
  resolveBookingTimes,
} from "./bookingsCreate.mjs";
import { resolveNights } from "../utils/bookingPricing.mjs";
import { httpError } from "../utils/httpError.mjs";
import {
  SERVICE_TYPES,
  WALK_DURATIONS,
  priceServiceOffering,
} from "../utils/servicePricing.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BOARDING_DEFAULT_TIME = "12:00";
const PER_WALK_DEFAULT_MINUTES = 60;

export const DURATION_UNIT_NIGHTS = "nights";
export const DURATION_UNIT_MINUTES = "minutes";
export const DURATION_UNIT_WALK = "walk";
export const DURATION_UNIT_HOURS = "hours";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asHm(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.trim().slice(0, 5);
  return String(value).slice(0, 5);
}

function requireDate(value, field) {
  const text = trimString(value);
  if (!DATE_RE.test(text)) {
    throw httpError(400, `Invalid ${field}`);
  }
  return text;
}

function requireTime(value, field) {
  const text = trimString(value);
  if (!TIME_RE.test(text)) {
    throw httpError(400, `Invalid ${field}`);
  }
  return text;
}

function parseTimeToMinutes(value) {
  const [, hh, mm] = value.match(TIME_RE);
  return Number(hh) * 60 + Number(mm);
}

export function addMinutesToTime(startTime, minutes) {
  const start = parseTimeToMinutes(startTime);
  const end = start + minutes;
  if (end > 24 * 60) {
    throw httpError(400, "Time slot must end on the same day");
  }
  if (end === 24 * 60) {
    return "23:59";
  }
  const hh = String(Math.floor(end / 60)).padStart(2, "0");
  const mm = String(end % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function optionalTime(value, fallback) {
  const text = trimString(value);
  if (!text) return fallback;
  return requireTime(text, "time");
}

export function normalizeServiceType(value) {
  const type = trimString(value);
  if (!SERVICE_TYPES.has(type)) {
    throw httpError(400, "serviceType must be boarding, dog_walking, or in_home");
  }
  return type;
}

function resolveWalkDurationMinutes(body) {
  if (body?.durationMinutes == null && body?.duration_minutes == null) {
    return null;
  }
  const minutes = Number(body.durationMinutes ?? body.duration_minutes);
  if (!WALK_DURATIONS.has(minutes)) {
    throw httpError(400, "durationMinutes must be 30, 45, or 60");
  }
  return minutes;
}

function resolveVisitHours(body, startTime, endTime) {
  if (body?.visitHours != null) {
    const hours = Number(body.visitHours);
    if (!Number.isInteger(hours) || hours < 1) {
      throw httpError(400, "visitHours must be a whole number of hours");
    }
    return hours;
  }
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw httpError(400, "endTime must be after startTime");
  }
  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes % 60 !== 0) {
    throw httpError(400, "Visit duration must be whole hours");
  }
  return durationMinutes / 60;
}

function nightRange(body) {
  const checkIn = trimString(body?.checkIn) || trimString(body?.startDate);
  const checkOut = trimString(body?.checkOut) || trimString(body?.endDate);
  if (checkIn || checkOut) {
    const startDate = requireDate(checkIn, "checkIn");
    const endDate = requireDate(checkOut, "checkOut");
    if (endDate <= startDate) {
      throw httpError(400, "checkOut must be after checkIn");
    }
    return { startDate, endDate, nights: resolveNights(startDate, endDate) };
  }
  const { startDate, endDate } = resolveBookingDateRange(body);
  if (!isManyDayBooking(startDate, endDate)) {
    throw httpError(400, "checkOut must be after checkIn");
  }
  return { startDate, endDate, nights: resolveNights(startDate, endDate) };
}

export function resolveServiceWindow(body) {
  const serviceType = normalizeServiceType(body?.serviceType);
  const modeRaw = trimString(body?.mode) || null;

  if (serviceType === "boarding") {
    if (modeRaw) {
      throw httpError(400, "boarding does not take a mode");
    }
    const { startDate, endDate, nights } = nightRange(body);
    const startTime = optionalTime(body?.startTime ?? body?.checkInTime, BOARDING_DEFAULT_TIME);
    const endTime = optionalTime(body?.endTime ?? body?.checkOutTime, BOARDING_DEFAULT_TIME);
    return {
      serviceType,
      mode: null,
      durationMinutes: null,
      startDate,
      endDate,
      startTime,
      endTime,
      duration: nights,
      durationUnit: DURATION_UNIT_NIGHTS,
      nights,
      hours: null,
    };
  }

  if (serviceType === "dog_walking") {
    const date = requireDate(body?.date ?? body?.startDate, "date");
    const startTime = requireTime(body?.startTime, "startTime");
    const requestedMinutes = resolveWalkDurationMinutes(body);
    let mode = modeRaw;
    if (!mode) {
      mode = requestedMinutes ? "duration" : "per_walk";
    }
    if (mode !== "per_walk" && mode !== "duration") {
      throw httpError(400, "dog_walking mode must be per_walk or duration");
    }
    const durationMinutes =
      mode === "duration"
        ? requestedMinutes ??
          (() => {
            throw httpError(400, "durationMinutes is required for duration walks");
          })()
        : requestedMinutes ?? PER_WALK_DEFAULT_MINUTES;
    const endTime = addMinutesToTime(startTime, durationMinutes);
    return {
      serviceType,
      mode,
      durationMinutes: mode === "duration" ? durationMinutes : null,
      startDate: date,
      endDate: date,
      startTime,
      endTime,
      duration: mode === "per_walk" ? 1 : durationMinutes,
      durationUnit: mode === "per_walk" ? DURATION_UNIT_WALK : DURATION_UNIT_MINUTES,
      nights: null,
      hours: null,
      slotMinutes: durationMinutes,
    };
  }

  if (modeRaw !== "visit" && modeRaw !== "overnight") {
    throw httpError(400, "in_home mode must be visit or overnight");
  }

  if (modeRaw === "overnight") {
    const { startDate, endDate, nights } = nightRange(body);
    const startTime = optionalTime(body?.startTime, BOARDING_DEFAULT_TIME);
    const endTime = optionalTime(body?.endTime, BOARDING_DEFAULT_TIME);
    return {
      serviceType,
      mode: "overnight",
      durationMinutes: null,
      startDate,
      endDate,
      startTime,
      endTime,
      duration: nights,
      durationUnit: DURATION_UNIT_NIGHTS,
      nights,
      hours: null,
    };
  }

  const date = requireDate(body?.date ?? body?.startDate, "date");
  const startTime = requireTime(body?.startTime, "startTime");
  const endTime = trimString(body?.endTime)
    ? requireTime(body.endTime, "endTime")
    : null;
  if (!endTime && body?.visitHours == null) {
    throw httpError(400, "visitHours or endTime is required");
  }
  const hours = resolveVisitHours(body, startTime, endTime ?? addMinutesToTime(startTime, 60));
  const resolvedEnd = endTime ?? addMinutesToTime(startTime, hours * 60);
  return {
    serviceType,
    mode: "visit",
    durationMinutes: null,
    startDate: date,
    endDate: date,
    startTime,
    endTime: resolvedEnd,
    duration: hours,
    durationUnit: DURATION_UNIT_HOURS,
    nights: null,
    hours,
  };
}

export function matchingOffering(offerings, { serviceType, mode, durationMinutes }) {
  return (
    offerings.find(
      (row) =>
        row.type === serviceType &&
        (row.mode ?? null) === (mode ?? null) &&
        (row.duration_minutes ?? row.durationMinutes ?? null) ===
          (durationMinutes ?? null) &&
        row.is_active !== false
    ) ?? null
  );
}

export function quoteFromOffering(window, offering, { petCount, hasCctv = false } = {}) {
  if (!offering) {
    throw httpError(404, "This sitter does not offer that service");
  }
  const unitPrice = Number(offering.price_amount ?? offering.priceAmount);
  const totalPrice = priceServiceOffering({
    type: window.serviceType,
    mode: window.mode,
    nights: window.nights,
    hours: window.hours,
    unitPrice,
  });
  return {
    serviceId: offering.id,
    serviceType: window.serviceType,
    mode: window.mode,
    durationMinutes: window.durationMinutes,
    startDate: window.startDate,
    endDate: window.endDate,
    startTime: window.startTime,
    endTime: window.endTime,
    duration: window.duration,
    durationUnit: window.durationUnit,
    nights: window.nights,
    hours: window.hours,
    petCount: petCount ?? null,
    unitPrice,
    currency: offering.currency ?? "THB",
    totalPrice,
    hasCctv: window.serviceType === "boarding" ? Boolean(hasCctv) : false,
    quantity:
      window.serviceType === "boarding" || window.mode === "overnight"
        ? window.nights
        : window.serviceType === "in_home"
          ? window.hours
          : 1,
  };
}

/**
 * Reschedule pricing: when the booking has a service_id, recompute from the
 * offering (boarding 2 nights × 1200 = 2400). Legacy bookings without a
 * service stay on hourly/nightly fallback rates.
 */
export function resolveReschedulePricing(booking, body) {
  const serviceId = booking?.service_id ?? booking?.serviceId ?? null;
  if (serviceId) {
    const serviceType = booking.service_type ?? booking.serviceType;
    const mode = booking.service_mode ?? booking.serviceMode ?? null;
    const durationMinutes =
      booking.service_duration_minutes ?? booking.serviceDurationMinutes ?? null;
    const window = resolveServiceWindow({
      ...body,
      serviceType,
      mode: body?.mode ?? mode,
      durationMinutes: body?.durationMinutes ?? durationMinutes,
      checkIn: body?.checkIn ?? body?.startDate,
      checkOut: body?.checkOut ?? body?.endDate,
      date: body?.date ?? body?.startDate,
      startTime: body?.startTime ?? asHm(booking.start_time ?? booking.startTime),
      endTime: body?.endTime ?? asHm(booking.end_time ?? booking.endTime),
    });
    const quote = quoteFromOffering(
      window,
      {
        id: serviceId,
        type: serviceType,
        mode,
        duration_minutes: durationMinutes,
        price_amount: booking.service_unit_price ?? booking.serviceUnitPrice,
        currency: booking.currency ?? "THB",
      },
      { petCount: Number(booking.pet_count ?? booking.petCount) || null }
    );
    return {
      startDate: quote.startDate,
      endDate: quote.endDate,
      startTime: quote.startTime,
      endTime: quote.endTime,
      duration: quote.duration,
      durationUnit: quote.durationUnit,
      totalPrice: quote.totalPrice,
    };
  }

  const { startDate, endDate } = resolveBookingDateRange(body);
  const { startTime, endTime } = resolveBookingTimes({
    startDate,
    endDate,
    startTime: body?.startTime,
    endTime: body?.endTime,
  });
  const { duration, durationUnit, totalPrice } = resolveBookingPricing({
    startDate,
    endDate,
    startTime,
    endTime,
    petCount: Number(booking?.pet_count ?? booking?.petCount) || 1,
  });
  return { startDate, endDate, startTime, endTime, duration, durationUnit, totalPrice };
}

/** Client totalPrice is ignored — quote is always recomputed from the offering. */
export function buildServiceQuote(body, offerings, extras = {}) {
  const window = resolveServiceWindow(body);
  const offering = matchingOffering(offerings, window);
  return quoteFromOffering(window, offering, extras);
}

export function hasConflict(existingSlots, incoming) {
  return existingSlots.some((slot) => doBookingsOverlap(slot, incoming));
}

export function assertNoConflict(existingSlots, incoming) {
  if (hasConflict(existingSlots, incoming)) {
    throw httpError(
      409,
      "This date and time is already booked. Please choose another slot."
    );
  }
}

export function requireInHomeAddress(body, serviceType) {
  if (serviceType !== "in_home") {
    return { ownerAddress: null, accessInstructions: null };
  }
  const ownerAddress = trimString(body?.ownerAddress ?? body?.address);
  if (!ownerAddress) {
    throw httpError(400, "ownerAddress is required for in-home bookings");
  }
  const accessInstructions = trimString(body?.accessInstructions) || null;
  return { ownerAddress, accessInstructions };
}

export function assertDogsOnly(pets) {
  const notDog = pets.find(
    (pet) => String(pet.pet_type ?? pet.petType ?? "").trim().toLowerCase() !== "dog"
  );
  if (notDog) {
    throw httpError(400, "Dog walking is for dogs only");
  }
}
