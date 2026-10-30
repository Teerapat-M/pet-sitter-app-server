import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { migrate, poolConfig } from "../db/migrate.mjs";
import { bookingsRepository } from "../repositories/bookings.repository.mjs";
import connectionPool from "../utils/db.mjs";

const { Client } = pg;

function isLocalPostgres(url = process.env.DATABASE_URL) {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

const useDb = isLocalPostgres();

function digitsPhone(seed) {
  return `09${String(seed).replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
}

describe("parallel booking create", { skip: !useDb }, () => {
  const ownerId = randomUUID();
  const sitterId = randomUUID();
  let petId;
  let client;

  before(async () => {
    await migrate();
    client = new Client(poolConfig());
    await client.connect();
    const token = randomUUID().replace(/-/g, "").slice(0, 8);
    await client.query(
      `INSERT INTO public.users (id, name, email, phone, id_number, date_of_birth)
       VALUES
         ($1, 'Owner Parallel', $3, $5, '1103700999001', '1994-03-18'),
         ($2, 'Sitter Parallel', $4, $6, '1103700999002', '1992-07-02')`,
      [
        ownerId,
        sitterId,
        `owner-${token}@petsitter.demo`,
        `sitter-${token}@petsitter.demo`,
        digitsPhone(`1${token}`),
        digitsPhone(`2${token}`),
      ]
    );
    const { rows: typeRows } = await client.query(
      `SELECT id FROM public.pet_types WHERE name = 'Dog' LIMIT 1`
    );
    const { rows: petRows } = await client.query(
      `INSERT INTO public.pets (owner_id, pet_type_id, name)
       VALUES ($1, $2, 'Bobo Race')
       RETURNING id`,
      [ownerId, typeRows[0].id]
    );
    petId = petRows[0].id;
  });

  after(async () => {
    try {
      if (!client) return;
      await client.query(
        `DELETE FROM public.bookings WHERE owner_id = $1 OR sitter_id = $2`,
        [ownerId, sitterId]
      );
      await client.query(`DELETE FROM public.pets WHERE owner_id = $1`, [ownerId]);
      await client.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [
        [ownerId, sitterId],
      ]);
    } finally {
      if (client) await client.end();
      await connectionPool.end();
    }
  });

  it("lets exactly one of 20 overlapping creates succeed when the sitter has none", async () => {
    const payload = {
      ownerId,
      sitterId,
      startDate: "2027-03-01",
      endDate: "2027-03-01",
      startTime: "10:00",
      endTime: "13:00",
      duration: 3,
      durationUnit: "hours",
      paymentMethod: "cash",
      contactName: "Owner Parallel",
      contactEmail: "owner@petsitter.demo",
      contactPhone: "0812345678",
      additionalMessage: null,
      totalPrice: 600,
      petIds: [petId],
    };

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => bookingsRepository.createBookingWithPets(payload))
    );
    const ok = results.filter((row) => row.status === "fulfilled");
    const conflict = results.filter(
      (row) => row.status === "rejected" && row.reason?.statusCode === 409
    );
    const other = results.filter(
      (row) =>
        row.status === "rejected" && row.reason?.statusCode !== 409
    );

    assert.equal(other.length, 0, other[0]?.reason?.message ?? "unexpected errors");
    assert.equal(ok.length, 1);
    assert.equal(conflict.length, 19);

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM public.bookings
       WHERE sitter_id = $1
         AND start_date = '2027-03-01'
         AND status IN ('waiting_confirm', 'waiting_service', 'in_service')`,
      [sitterId]
    );
    assert.equal(rows[0].n, 1);
  });
});
