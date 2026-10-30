import { bookingsRepository } from "../repositories/bookings.repository.mjs";
import { petsRepository } from "../repositories/pets.repository.mjs";
import { sitterProfilesRepository } from "../repositories/sitterProfiles.repository.mjs";
import { servicesRepository } from "../repositories/services.repository.mjs";
import { conversationsRepository } from "../repositories/conversations.repository.mjs";
import { getStripe } from "../repositories/stripe.mjs";
import {
  resolveBookingDateRange,
  resolveBookingPricing,
  resolveBookingTimes,
} from "./bookingsCreate.mjs";
import {
  assertDogsOnly,
  buildServiceQuote,
  hasConflict,
  requireInHomeAddress,
  resolveReschedulePricing,
} from "./bookingQuote.mjs";
import {
  shouldMarkCashPaidOnStatusChange,
  shouldCaptureStripeOnConfirm,
  shouldCancelStripePayment,
} from "./payoutEligibility.mjs";
import {
  captureStripePaymentIntent,
  cancelStripePaymentIntent,
  createCheckoutSession,
  refundStripePaymentIfCaptured,
} from "./stripeBookingPayment.mjs";
import { toStripeAmount } from "../utils/stripeAmount.mjs";
import { endSessionsForBooking } from "./cameraEvents.mjs";
import { reviewsRepository } from "../repositories/reviews.repository.mjs";
import { reportsRepository } from "../repositories/reports.repository.mjs";
import { httpError } from "../utils/httpError.mjs";
import { isOwnerProfileComplete } from "../middlewares/validateUsers.mjs";
import { notificationsService } from "./notifications.service.mjs";
import { assertNotSelfBooking } from "../utils/bookingAuth.mjs";
import {
  assertOwnerCanCancel,
  assertOwnerCanReschedule,
  assertOwnerCanReview,
  assertValidSitterTransition,
} from "../utils/bookingStatus.mjs";

const PAYMENT_METHODS = new Set(["cash", "stripe"]);

function normalizePetIds(petIds) {
  if (!Array.isArray(petIds) || petIds.length === 0) {
    throw httpError(400, "At least one pet is required");
  }

  const normalized = [];
  for (const id of petIds) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) {
      throw httpError(400, "Invalid petIds");
    }
    normalized.push(n);
  }

  return [...new Set(normalized)];
}

function parsePetTypes(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function linkConversation(ownerId, sitterId, bookingId) {
  const existing = await conversationsRepository.findByOwnerAndSitter(
    ownerId,
    sitterId
  );
  if (existing) {
    return conversationsRepository.setBookingId(existing.id, bookingId);
  }
  return conversationsRepository.create({ ownerId, sitterId, bookingId });
}

function conversationIdOf(row) {
  return row?.id != null ? String(row.id) : null;
}

async function reverseStripeIfNeeded(booking, nextStatus) {
  if (
    !shouldCancelStripePayment({
      paymentMethod: booking.payment_method,
      nextStatus,
    })
  ) {
    return;
  }
  await cancelStripePaymentIntent(booking.payment_token);
  if (booking.payment_status === "paid") {
    await refundStripePaymentIfCaptured(booking.payment_token);
  }
}

export const bookingsService = {
  async getMyBookings(sitterId, search, status, limit, offset) {
    return bookingsRepository.findManyBySitterId(
      sitterId,
      search,
      status,
      limit,
      offset
    );
  },

  async getMyBookingById(sitterId, bookingId) {
    const booking = await bookingsRepository.findByIdAndSitterId(
      sitterId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    return booking;
  },

  async updateMyBookingStatus(sitterId, bookingId, requestedStatus) {
    const booking = await bookingsRepository.findByIdAndSitterId(
      sitterId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    const nextStatus = assertValidSitterTransition(booking.status, requestedStatus);

    await reverseStripeIfNeeded(booking, nextStatus);

    // T03 — capture ก่อนเปลี่ยน status (fail แล้วไม่อัปเดต booking)
    // Checkout already captured — skip if webhook marked paid.
    if (
      shouldCaptureStripeOnConfirm({
        paymentMethod: booking.payment_method,
        nextStatus,
      }) &&
      booking.payment_status !== "paid" &&
      String(booking.payment_token ?? "").startsWith("pi_")
    ) {
      await captureStripePaymentIntent(booking.payment_token);
    }

    const updated = await bookingsRepository.updateStatusByIdAndSitterId(
      sitterId,
      bookingId,
      nextStatus
    );

    if (booking.status === "in_service" && nextStatus !== "in_service") {
      endSessionsForBooking(bookingId, "booking_ended");
    }

    const ownerId = booking.owner_id ?? booking.pet_owner?.id;
    if (nextStatus === "waiting_service" && ownerId) {
      await notificationsService.notifyOwnerBookingConfirmed({
        ownerId,
        sitterId,
        bookingId: booking.id,
      });
    }

    if (nextStatus === "cancelled" && ownerId) {
      await notificationsService.notifyOwnerSitterCancelled({
        ownerId: booking.owner_id,
        sitterId,
        bookingId: booking.id,
      });
    }

    // T02 — cash + in_service → mark payments.paid (earnings eligible)
    if (
      shouldMarkCashPaidOnStatusChange({
        paymentMethod: booking.payment_method,
        nextStatus,
      })
    ) {
      await bookingsRepository.markPaymentPaidByBookingId(bookingId);
    }

    return updated;
  },

  // Booking History (list) — pass-through ไปที่ repository ตรง ๆ ไม่มี business
  // logic เพิ่มเติม เพราะเป็นแค่การอ่านข้อมูล/ค้นหา/แบ่งหน้า
  async getOwnerBookings(ownerId, search, status, limit, offset) {
    return bookingsRepository.findManyByOwnerId(
      ownerId,
      search,
      status,
      limit,
      offset
    );
  },

  // Booking History (detail) — ดึง booking ทีละรายการ ถ้าไม่เจอ (หรือไม่ใช่ของ
  // owner คนนี้) ให้ throw 404 แทนที่จะคืน null เพื่อให้ controller ตอบ error ได้ทันที
  async getOwnerBookingById(ownerId, bookingId) {
    const booking = await bookingsRepository.findByIdAndOwnerId(
      ownerId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    return booking;
  },

  // Booking History — ยกเลิก booking ได้เฉพาะตอนที่ sitter ยังไม่ confirm
  // (waiting_confirm) เพื่อกันไม่ให้ยกเลิกงานที่กำลังดำเนินการอยู่แล้ว
  // ถ้าจ่ายผ่าน stripe ต้อง cancel payment intent (คืนวงเงินที่ authorize ไว้)
  // ก่อนเปลี่ยนสถานะ booking แล้วแจ้งเตือน sitter ว่าโดนยกเลิก
  async cancelOwnerBooking(ownerId, bookingId) {
    const booking = await bookingsRepository.findByIdAndOwnerId(
      ownerId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    assertOwnerCanCancel(booking.status);

    await reverseStripeIfNeeded(booking, "cancelled");

    const updated = await bookingsRepository.updateStatusByIdAndOwnerId(
      ownerId,
      bookingId,
      "cancelled"
    );

    await notificationsService.notifySitterOwnerCancelled({
      ownerId,
      sitterId: booking.sitter_id,
      bookingId: booking.id,
    });

    return updated;
  },

  // Booking History — เลื่อนวัน/เวลา booking ได้เฉพาะตอน waiting_confirm
  // ขั้นตอน: (1) resolve วัน/เวลาใหม่ (2) เช็คว่าไม่ชนกับ booking อื่นของ sitter คนเดิม
  // (3) คำนวณราคาใหม่ตามช่วงเวลาที่เปลี่ยน (4) ถ้าจ่ายด้วย stripe ราคาต้องเท่าเดิม
  // เพราะ payment intent ถูก authorize ไว้ที่ยอดเดิมแล้ว capture ทีหลังไม่สามารถ
  // เปลี่ยนยอดได้ จึงบล็อกไว้ก่อนแทนที่จะปล่อยให้ยอดเพี้ยน
  async rescheduleOwnerBooking(ownerId, bookingId, body) {
    const booking = await bookingsRepository.findByIdAndOwnerId(
      ownerId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    assertOwnerCanReschedule(booking.status);

    const {
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      durationUnit,
      totalPrice,
    } = resolveReschedulePricing(booking, body);

    // Stripe already authorized the original amount — capture later pulls that
    // exact amount, so a card-paid booking can only move to a slot priced the
    // same. Raising or silently under-capturing an existing PaymentIntent here
    // isn't safe, so block it instead of drifting the charged amount.
    if (
      booking.payment_method === "stripe" &&
      Number(totalPrice) !== Number(booking.total_price)
    ) {
      throw httpError(
        400,
        "This date/time would change the price, which isn't supported for card-paid bookings. Cancel and create a new booking instead."
      );
    }

    return bookingsRepository.updateScheduleByIdAndOwnerId(
      ownerId,
      bookingId,
      booking.sitter_id,
      {
        startDate,
        endDate,
        startTime,
        endTime,
        duration,
        durationUnit,
        totalPrice,
      }
    );
  },

  // Booking History — รีวิวได้เฉพาะ booking ที่จบงานแล้ว (status = success)
  // และรีวิวได้ครั้งเดียวต่อ booking (กันเขียนซ้ำ)
  async submitReview(ownerId, bookingId, rating, text) {
    const booking = await bookingsRepository.findByIdAndOwnerId(
      ownerId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    assertOwnerCanReview(booking.status);

    if (booking.review) {
      throw httpError(409, "Booking already reviewed");
    }

    return reviewsRepository.create({
      bookingId,
      ownerId,
      sitterId: booking.sitter_id,
      rating,
      text,
    });
  },

  // Booking History — แจ้งปัญหาเกี่ยวกับ booking นี้ (ไม่จำกัดสถานะ booking)
  async submitReport(ownerId, bookingId, subject, description) {
    const booking = await bookingsRepository.findByIdAndOwnerId(
      ownerId,
      bookingId
    );

    if (!booking) {
      throw httpError(404, "Booking not found");
    }

    return reportsRepository.create({
      bookingId,
      reporterId: ownerId,
      subject,
      description,
    });
  },

  // สร้าง booking ใหม่ (ปุ่ม "จอง" ของ owner) — cash | stripe
  // (ไม่เชื่อ totalPrice จาก client, คำนวณราคาเองฝั่ง server เสมอ)
  // ลำดับการตรวจสอบ: payment method ที่รองรับ -> วัน/เวลาที่ขอ -> owner ไม่ถูกแบน
  // -> ไม่จองตัวเอง -> pet เป็นของ owner จริงและไม่ถูกระงับ -> sitter รับ pet type
  // นี้ไหม -> โปรไฟล์ owner ครบไหม -> ช่วงเวลาชนกับ booking อื่นของ sitter ไหม
  // ผ่านหมดแล้วค่อย insert booking+pets+payment ใน transaction เดียว (ดู
  // bookingsRepository.createBookingWithPets) แล้วถ้าเป็น stripe จะสร้าง
  // PaymentIntent แบบ manual capture (authorize ไว้ก่อน, capture ตอน sitter confirm)
  async quote(owner, body) {
    const sitterId = typeof body?.sitterId === "string" ? body.sitterId.trim() : "";
    if (!sitterId) {
      throw httpError(400, "sitterId is required");
    }

    const sitter = await sitterProfilesRepository.findPublicById(sitterId);
    if (!sitter) {
      throw httpError(404, "Sitter profile not found");
    }

    const [offerings, hasCctv] = await Promise.all([
      servicesRepository.listActiveBySitterId(sitterId),
      servicesRepository.sitterHasCctv(sitterId),
    ]);

    let petCount = null;
    let pets = [];
    if (Array.isArray(body?.petIds) && body.petIds.length > 0 && owner?.id) {
      const petIds = normalizePetIds(body.petIds);
      pets = await petsRepository.findManyByIds(petIds, owner.id);
      petCount = pets.length;
    }

    const quote = buildServiceQuote(body, offerings, { petCount, hasCctv });
    if (quote.serviceType === "dog_walking" && pets.length) {
      assertDogsOnly(pets);
    }
    const busy = await bookingsRepository.findBusySlotsBySitterId(sitterId);
    return { ...quote, available: !hasConflict(busy, quote) };
  },

  async acceptMyBooking(sitterId, bookingId) {
    return this.updateMyBookingStatus(sitterId, bookingId, "waiting_service");
  },

  async declineMyBooking(sitterId, bookingId) {
    return this.updateMyBookingStatus(sitterId, bookingId, "cancelled");
  },

  async createCheckout(ownerId, bookingId) {
    const booking = await bookingsRepository.findByIdAndOwnerId(ownerId, bookingId);
    if (!booking) {
      throw httpError(404, "Booking not found");
    }
    if (booking.payment_method !== "stripe") {
      throw httpError(400, "Checkout is only for Stripe bookings");
    }
    if (booking.status === "cancelled") {
      throw httpError(400, "Cannot pay a cancelled booking");
    }
    if (booking.payment_status === "paid") {
      throw httpError(400, "Booking is already paid");
    }

    const session = await createCheckoutSession({
      bookingId: booking.id,
      amount: booking.total_price,
    });
    await bookingsRepository.updatePaymentTokenByBookingId(
      booking.id,
      session.payment_intent || session.id
    );
    return {
      bookingId: booking.id,
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
    };
  },

  async createBooking(owner, body) {
    if (body?.serviceType) {
      return this.createServiceBooking(owner, body);
    }

    const {
      sitterId,
      petIds: rawPetIds,
      message,
      paymentMethod,
    } = body ?? {};

    if (!PAYMENT_METHODS.has(paymentMethod)) {
      throw httpError(400, "paymentMethod must be cash or stripe");
    }

    if (typeof sitterId !== "string" || !sitterId.trim()) {
      throw httpError(400, "sitterId is required");
    }

    const { startDate, endDate } = resolveBookingDateRange(body);
    const { startTime, endTime } = resolveBookingTimes({
      startDate,
      endDate,
      startTime: body?.startTime,
      endTime: body?.endTime,
    });

    if (owner.is_banned) {
      throw httpError(403, "This account has been banned");
    }

    assertNotSelfBooking(owner.id, sitterId);

    const petIds = normalizePetIds(rawPetIds);
    const { duration, durationUnit, totalPrice } = resolveBookingPricing({
      startDate,
      endDate,
      startTime,
      endTime,
      petCount: petIds.length,
    });

    const sitter = await sitterProfilesRepository.findPublicById(sitterId);
    if (!sitter) {
      throw httpError(404, "Sitter profile not found");
    }

    const pets = await petsRepository.findManyByIds(petIds, owner.id);
    if (pets.length !== petIds.length) {
      throw httpError(400, "One or more pets do not belong to you");
    }
    if (pets.some((pet) => pet.is_suspended)) {
      throw httpError(400, "One or more pets are suspended and cannot be booked");
    }

    const acceptedTypes = new Set(
      parsePetTypes(sitter.pet_types).map((name) =>
        String(name).trim().toLowerCase()
      )
    );
    const unsupported = pets.find(
      (pet) => !acceptedTypes.has(String(pet.pet_type).trim().toLowerCase())
    );
    if (unsupported) {
      throw httpError(400, "One or more pets are not accepted by this sitter");
    }

    if (!isOwnerProfileComplete(owner)) {
      throw httpError(400, "Please complete your profile before booking");
    }

    const overlapping = await bookingsRepository.hasOverlappingBooking({
      sitterId,
      startDate,
      endDate,
      startTime,
      endTime,
    });
    if (overlapping) {
      throw httpError(
        409,
        "This date and time is already booked. Please choose another slot."
      );
    }

    const additionalMessage =
      typeof message === "string" && message.trim()
        ? message.trim()
        : null;

    const created = await bookingsRepository.createBookingWithPets({
      ownerId: owner.id,
      sitterId,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      durationUnit,
      paymentMethod, // T01 — persist cash | stripe ลง bookings.payment_method
      contactName: (owner.name && String(owner.name).trim()) || owner.email,
      contactEmail: owner.email,
      contactPhone: owner.phone,
      additionalMessage,
      totalPrice,
      petIds,
    });

    await notificationsService.notifyOwnerHiredSitter({
      ownerId: owner.id,
      sitterId,
      bookingId: created.bookingId,
    });

    const conversation = await linkConversation(
      owner.id,
      sitterId,
      created.bookingId
    );

    if (paymentMethod === "cash") {
      return { ...created, conversationId: conversationIdOf(conversation) };
    }

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: toStripeAmount(created.totalPrice),
      currency: "thb",
      capture_method: "manual", // T03 — authorize ตอนจอง, capture ตอน sitter Confirm
      automatic_payment_methods: { enabled: true },
      metadata: { bookingId: String(created.bookingId) },
    });

    await bookingsRepository.updatePaymentTokenByBookingId(
      created.bookingId,
      paymentIntent.id
    );

    return {
      ...created,
      conversationId: conversationIdOf(conversation),
      clientSecret: paymentIntent.client_secret,
    };
  },

  async createServiceBooking(owner, body) {
    const paymentMethod = body?.paymentMethod;
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      throw httpError(400, "paymentMethod must be cash or stripe");
    }

    if (owner.is_banned) {
      throw httpError(403, "This account has been banned");
    }

    const sitterId =
      typeof body?.sitterId === "string" ? body.sitterId.trim() : "";
    if (!sitterId) {
      throw httpError(400, "sitterId is required");
    }
    assertNotSelfBooking(owner.id, sitterId);

    if (!isOwnerProfileComplete(owner)) {
      throw httpError(400, "Please complete your profile before booking");
    }

    const petIds = normalizePetIds(body?.petIds);
    const quote = await this.quote(owner, body);
    if (!quote.available) {
      throw httpError(
        409,
        "This date and time is already booked. Please choose another slot."
      );
    }

    const sitter = await sitterProfilesRepository.findPublicById(sitterId);
    if (!sitter) {
      throw httpError(404, "Sitter profile not found");
    }

    const pets = await petsRepository.findManyByIds(petIds, owner.id);
    if (pets.length !== petIds.length) {
      throw httpError(400, "One or more pets do not belong to you");
    }
    if (pets.some((pet) => pet.is_suspended)) {
      throw httpError(400, "One or more pets are suspended and cannot be booked");
    }
    if (quote.serviceType === "dog_walking") {
      assertDogsOnly(pets);
    }

    const acceptedTypes = new Set(
      parsePetTypes(sitter.pet_types).map((name) =>
        String(name).trim().toLowerCase()
      )
    );
    const unsupported = pets.find(
      (pet) => !acceptedTypes.has(String(pet.pet_type).trim().toLowerCase())
    );
    if (unsupported) {
      throw httpError(400, "One or more pets are not accepted by this sitter");
    }

    const { ownerAddress, accessInstructions } = requireInHomeAddress(
      body,
      quote.serviceType
    );

    const additionalMessage =
      typeof body?.message === "string" && body.message.trim()
        ? body.message.trim()
        : null;

    const created = await bookingsRepository.createBookingWithPets({
      ownerId: owner.id,
      sitterId,
      serviceId: quote.serviceId,
      startDate: quote.startDate,
      endDate: quote.endDate,
      startTime: quote.startTime,
      endTime: quote.endTime,
      duration: quote.duration,
      durationUnit: quote.durationUnit,
      paymentMethod,
      contactName: (owner.name && String(owner.name).trim()) || owner.email,
      contactEmail: owner.email,
      contactPhone: owner.phone,
      additionalMessage,
      ownerAddress,
      accessInstructions,
      totalPrice: quote.totalPrice,
      petIds,
    });

    await notificationsService.notifyOwnerHiredSitter({
      ownerId: owner.id,
      sitterId,
      bookingId: created.bookingId,
    });

    const conversation = await linkConversation(
      owner.id,
      sitterId,
      created.bookingId
    );

    const payload = {
      ...created,
      conversationId: conversationIdOf(conversation),
      serviceType: quote.serviceType,
      mode: quote.mode,
      hasCctv: quote.hasCctv,
      totalPrice: quote.totalPrice,
    };

    if (paymentMethod === "cash") {
      return payload;
    }

    const session = await createCheckoutSession({
      bookingId: created.bookingId,
      amount: quote.totalPrice,
    });
    await bookingsRepository.updatePaymentTokenByBookingId(
      created.bookingId,
      session.payment_intent || session.id
    );

    return {
      ...payload,
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
    };
  },
};
