-- Demo data for a fresh database. Idempotent (fixed ids + ON CONFLICT).
-- Not loginable via Supabase Auth: public.users rows only. Register with the
-- same email if you need a session, or insert matching auth.users yourself.
--
-- Demo password hint (Auth not seeded): Demo12345!
-- Owner  Arisa Thong  arisa.owner@petsitter.demo
-- Sitters Ploy S. / Nok P. / Ken T.

BEGIN;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
INSERT INTO public.users (
  id, name, email, phone, id_number, date_of_birth, avatar_url,
  is_admin, is_verified, is_banned
) VALUES
  (
    'a1111111-1111-4111-8111-111111111111',
    'Arisa Thong',
    'arisa.owner@petsitter.demo',
    '0812345678',
    '1103700123456',
    '1994-03-18',
    'https://i.pravatar.cc/150?u=arisa',
    false, true, false
  ),
  (
    'a2222222-2222-4222-8222-222222222222',
    'Ploy Sittichai',
    'ploy.sitter@petsitter.demo',
    '0823456789',
    '1103700123457',
    '1992-07-02',
    'https://i.pravatar.cc/150?u=ploy',
    false, true, false
  ),
  (
    'a3333333-3333-4333-8333-333333333333',
    'Nok Prasert',
    'nok.sitter@petsitter.demo',
    '0834567890',
    '1103700123458',
    '1990-11-21',
    'https://i.pravatar.cc/150?u=nok',
    false, true, false
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    'Ken Thanakit',
    'ken.sitter@petsitter.demo',
    '0845678901',
    '1103700123459',
    '1995-01-09',
    'https://i.pravatar.cc/150?u=ken',
    false, true, false
  ),
  (
    'a5555555-5555-4555-8555-555555555555',
    'Admin Panel',
    'admin@petsitter.demo',
    '0899999999',
    '1103700123460',
    '1988-05-05',
    'https://i.pravatar.cc/150?u=admin',
    true, true, false
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  id_number = EXCLUDED.id_number,
  date_of_birth = EXCLUDED.date_of_birth,
  avatar_url = EXCLUDED.avatar_url,
  is_admin = EXCLUDED.is_admin,
  is_verified = EXCLUDED.is_verified,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- sitters
-- ---------------------------------------------------------------------------
INSERT INTO public.sitter_profiles (
  user_id, display_name, introduction, my_place, services, experience_years,
  address_detail, district, sub_district, province, post_code,
  latitude, longitude, rating_avg, review_count, approval_status,
  is_listed, bank_name, account_number, account_name, bank_code
) VALUES
  (
    'a2222222-2222-4222-8222-222222222222',
    'Ploy S.',
    'Boarding and GPS walks in a fenced Thonglor garden. Three indoor cameras during your stay.',
    'Quiet townhouse with a grassy yard and a camera in the play room, living room, and garden.',
    'Boarding, dog walking, overnight in-home',
    '5+',
    '12 Sukhumvit 55',
    'Watthana',
    'Khlong Tan Nuea',
    'Bangkok',
    '10110',
    13.7308, 100.5813,
    5.0, 1, 'Approved', true,
    'SCB', '003345347444', 'Ploy Sittichai', 'SCB'
  ),
  (
    'a3333333-3333-4333-8333-333333333333',
    'Nok P.',
    'In-home cat and dog sitting — daytime visits or overnight in your house.',
    'I come to you. I bring treats, a first-aid kit, and daily photo updates.',
    'In-home visit, overnight stay',
    '3-5',
    '88 Phahonyothin 32',
    'Chatuchak',
    'Sena Nikhom',
    'Bangkok',
    '10900',
    13.8281, 100.5690,
    4.8, 0, 'Approved', true,
    'KBANK', '123456789012', 'Nok Prasert', 'KBANK'
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    'Ken T.',
    'Lumphini loop walker. Live GPS on every outing, rain or shine.',
    'Meet at the park gate or I pick up from nearby condos.',
    'Dog walking',
    '0-2',
    '1 Rama IV Rd',
    'Pathum Wan',
    'Lumphini',
    'Bangkok',
    '10330',
    13.7307, 100.5418,
    4.5, 0, 'Approved', true,
    'BBL', '987654321098', 'Ken Thanakit', 'BBL'
  )
ON CONFLICT (user_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  introduction = EXCLUDED.introduction,
  my_place = EXCLUDED.my_place,
  services = EXCLUDED.services,
  experience_years = EXCLUDED.experience_years,
  address_detail = EXCLUDED.address_detail,
  district = EXCLUDED.district,
  sub_district = EXCLUDED.sub_district,
  province = EXCLUDED.province,
  post_code = EXCLUDED.post_code,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  approval_status = EXCLUDED.approval_status,
  is_listed = EXCLUDED.is_listed,
  updated_at = now();

INSERT INTO public.sitter_pet_types (sitter_id, pet_type_id)
SELECT sitter_id, pet_types.id
FROM (
  VALUES
    ('a2222222-2222-4222-8222-222222222222'::uuid, 'Dog'),
    ('a2222222-2222-4222-8222-222222222222'::uuid, 'Cat'),
    ('a3333333-3333-4333-8333-333333333333'::uuid, 'Dog'),
    ('a3333333-3333-4333-8333-333333333333'::uuid, 'Cat'),
    ('a4444444-4444-4444-8444-444444444444'::uuid, 'Dog')
) AS t(sitter_id, type_name)
JOIN public.pet_types ON pet_types.name = t.type_name
ON CONFLICT DO NOTHING;

DELETE FROM public.sitter_photos
WHERE sitter_id IN (
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444'
);

INSERT INTO public.sitter_photos (id, sitter_id, photo_url, sort_order) VALUES
  (1, 'a2222222-2222-4222-8222-222222222222', 'https://picsum.photos/seed/ploy1/800/550', 0),
  (2, 'a2222222-2222-4222-8222-222222222222', 'https://picsum.photos/seed/ploy2/800/550', 1),
  (3, 'a3333333-3333-4333-8333-333333333333', 'https://picsum.photos/seed/nok1/800/550', 0),
  (4, 'a4444444-4444-4444-8444-444444444444', 'https://picsum.photos/seed/ken1/800/550', 0);

SELECT setval(pg_get_serial_sequence('public.sitter_photos', 'id'), 4, true);

-- ---------------------------------------------------------------------------
-- pets (Bobo, Mochi, Miso)
-- ---------------------------------------------------------------------------
INSERT INTO public.pets (
  id, owner_id, pet_type_id, name, breed, sex, age_months, color, weight_kg, about, avatar_url
)
SELECT
  v.id,
  'a1111111-1111-4111-8111-111111111111',
  pet_types.id,
  v.name, v.breed, v.sex, v.age_months, v.color, v.weight_kg, v.about, v.avatar_url
FROM (
  VALUES
    (1::bigint, 'Dog', 'Bobo', 'Golden Retriever', 'Male', 48, 'Golden', 32.0::real,
     'Vaccinated, Neutered, Allergy (chicken). Needs a slow morning walk and a puzzle feeder.',
     'https://picsum.photos/seed/bobo/400/400'),
    (2::bigint, 'Cat', 'Mochi', 'Scottish Fold', 'Female', 24, 'Cream', 4.0::real,
     'Indoor only. Loves window perches. Microchipped.',
     'https://picsum.photos/seed/mochi/400/400'),
    (3::bigint, 'Cat', 'Miso', 'Thai cat', 'Male', 72, 'White and brown', 5.0::real,
     'Talkative. Twice-daily wet food. Vet: Thonglor Pet Hospital.',
     'https://picsum.photos/seed/miso/400/400')
) AS v(id, type_name, name, breed, sex, age_months, color, weight_kg, about, avatar_url)
JOIN public.pet_types ON pet_types.name = v.type_name
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  breed = EXCLUDED.breed,
  about = EXCLUDED.about,
  weight_kg = EXCLUDED.weight_kg,
  avatar_url = EXCLUDED.avatar_url;

SELECT setval(pg_get_serial_sequence('public.pets', 'id'), 3, true);

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
INSERT INTO public.services (
  id, sitter_id, type, mode, duration_minutes, price_amount
) VALUES
  ('c1000001-0001-4001-8001-000000000001', 'a2222222-2222-4222-8222-222222222222', 'boarding', NULL, NULL, 1200),
  ('c1000001-0001-4001-8001-000000000002', 'a2222222-2222-4222-8222-222222222222', 'dog_walking', 'per_walk', NULL, 250),
  ('c1000001-0001-4001-8001-000000000003', 'a2222222-2222-4222-8222-222222222222', 'dog_walking', 'duration', 30, 200),
  ('c1000001-0001-4001-8001-000000000004', 'a2222222-2222-4222-8222-222222222222', 'dog_walking', 'duration', 45, 280),
  ('c1000001-0001-4001-8001-000000000005', 'a2222222-2222-4222-8222-222222222222', 'dog_walking', 'duration', 60, 350),
  ('c1000001-0001-4001-8001-000000000006', 'a2222222-2222-4222-8222-222222222222', 'in_home', 'overnight', NULL, 1500),
  ('c1000001-0001-4001-8001-000000000007', 'a3333333-3333-4333-8333-333333333333', 'in_home', 'visit', NULL, 450),
  ('c1000001-0001-4001-8001-000000000008', 'a3333333-3333-4333-8333-333333333333', 'in_home', 'overnight', NULL, 1400),
  ('c1000001-0001-4001-8001-000000000009', 'a4444444-4444-4444-8444-444444444444', 'dog_walking', 'per_walk', NULL, 220),
  ('c1000001-0001-4001-8001-00000000000a', 'a4444444-4444-4444-8444-444444444444', 'dog_walking', 'duration', 60, 320)
ON CONFLICT (id) DO UPDATE SET
  price_amount = EXCLUDED.price_amount,
  is_active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- bookings
-- PS-2481 boarding in service (CCTV window through 15 Nov 12:00)
-- PS-2502 walk live now
-- PS-2533 in-home visit upcoming
-- PS-2410 walk completed with summary
-- ---------------------------------------------------------------------------
INSERT INTO public.bookings (
  id, owner_id, sitter_id, service_id,
  start_date, end_date, start_time, end_time,
  duration, duration_unit, payment_method, transaction_no,
  contact_name, contact_email, contact_phone, additional_message,
  total_price, status
) VALUES
  (
    'b0000001-0001-4001-8001-000000000001',
    'a1111111-1111-4111-8111-111111111111',
    'a2222222-2222-4222-8222-222222222222',
    'c1000001-0001-4001-8001-000000000001',
    '2026-10-28', '2026-11-15', '12:00', '12:00',
    18, 'Day', 'stripe', 'PS-2481',
    'Arisa Thong', 'arisa.owner@petsitter.demo', '0812345678',
    'Boarding for Bobo and Mochi. CCTV included.',
    18000, 'in_service'
  ),
  (
    'b0000002-0002-4002-8002-000000000002',
    'a1111111-1111-4111-8111-111111111111',
    'a2222222-2222-4222-8222-222222222222',
    'c1000001-0001-4001-8001-000000000002',
    '2026-10-30', '2026-10-30', '09:00', '10:00',
    1, 'hours', 'cash', 'PS-2502',
    'Arisa Thong', 'arisa.owner@petsitter.demo', '0812345678',
    'Walk 3 — live GPS now.',
    250, 'in_service'
  ),
  (
    'b0000003-0003-4003-8003-000000000003',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    'c1000001-0001-4001-8001-000000000007',
    '2026-11-02', '2026-11-02', '13:00', '15:00',
    2, 'hours', 'cash', 'PS-2533',
    'Arisa Thong', 'arisa.owner@petsitter.demo', '0812345678',
    'Daytime visit for Miso. Spare key in the lockbox.',
    450, 'waiting_service'
  ),
  (
    'b0000004-0004-4004-8004-000000000004',
    'a1111111-1111-4111-8111-111111111111',
    'a4444444-4444-4444-8444-444444444444',
    'c1000001-0001-4001-8001-000000000009',
    '2026-10-20', '2026-10-20', '07:00', '08:00',
    1, 'hours', 'stripe', 'PS-2410',
    'Arisa Thong', 'arisa.owner@petsitter.demo', '0812345678',
    'Morning Lumphini loop.',
    220, 'success'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  service_id = EXCLUDED.service_id,
  total_price = EXCLUDED.total_price,
  additional_message = EXCLUDED.additional_message,
  updated_at = now();

INSERT INTO public.booking_pets (booking_id, pet_id) VALUES
  ('b0000001-0001-4001-8001-000000000001', 1),
  ('b0000001-0001-4001-8001-000000000001', 2),
  ('b0000002-0002-4002-8002-000000000002', 1),
  ('b0000003-0003-4003-8003-000000000003', 3),
  ('b0000004-0004-4004-8004-000000000004', 1)
ON CONFLICT DO NOTHING;

INSERT INTO public.payments (booking_id, amount, status, payment_token, paid_at) VALUES
  ('b0000001-0001-4001-8001-000000000001', 18000, 'paid', 'pi_demo_ps2481', '2026-10-27 10:00+07'),
  ('b0000002-0002-4002-8002-000000000002', 250, 'paid', NULL, '2026-10-30 09:05+07'),
  ('b0000003-0003-4003-8003-000000000003', 450, 'pending', NULL, NULL),
  ('b0000004-0004-4004-8004-000000000004', 220, 'paid', 'pi_demo_ps2410', '2026-10-20 07:10+07')
ON CONFLICT (booking_id) DO UPDATE SET
  amount = EXCLUDED.amount,
  status = EXCLUDED.status,
  payment_token = EXCLUDED.payment_token,
  paid_at = EXCLUDED.paid_at;

SELECT setval(
  'public.booking_transaction_no_seq',
  GREATEST(4, (SELECT last_value FROM public.booking_transaction_no_seq)),
  true
);

-- ---------------------------------------------------------------------------
-- review on the completed walk
-- ---------------------------------------------------------------------------
INSERT INTO public.reviews (id, booking_id, owner_id, sitter_id, rating, comment, is_approved)
VALUES (
  1,
  'b0000004-0004-4004-8004-000000000004',
  'a1111111-1111-4111-8111-111111111111',
  'a4444444-4444-4444-8444-444444444444',
  5,
  'Ken sent the GPS trail and a photo of Bobo at the lake. On time, calm, would book again.',
  true
)
ON CONFLICT (booking_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  comment = EXCLUDED.comment,
  is_approved = true;

SELECT setval(pg_get_serial_sequence('public.reviews', 'id'), 1, true);

-- ---------------------------------------------------------------------------
-- chat
-- ---------------------------------------------------------------------------
INSERT INTO public.conversations (id, owner_id, sitter_id) VALUES
  (1, 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222'),
  (2, 'a1111111-1111-4111-8111-111111111111', 'a3333333-3333-4333-8333-333333333333'),
  (3, 'a1111111-1111-4111-8111-111111111111', 'a4444444-4444-4444-8444-444444444444')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.conversations', 'id'), 3, true);

DELETE FROM public.messages WHERE conversation_id IN (1, 2, 3);

INSERT INTO public.messages (conversation_id, sender_id, content, sent_at) VALUES
  (1, 'a1111111-1111-4111-8111-111111111111', 'Hi Ploy — Bobo is booked for boarding and a walk this week.', '2026-10-27 09:10+07'),
  (1, 'a2222222-2222-4222-8222-222222222222', 'Saw the booking. Walk 3 is live now — you can open GPS tracking.', '2026-10-30 09:12+07'),
  (2, 'a3333333-3333-4333-8333-333333333333', 'Confirmed the 2 Nov visit for Miso. I will text before I enter.', '2026-10-29 18:40+07'),
  (3, 'a4444444-4444-4444-8444-444444444444', 'Yesterday’s Lumphini loop is saved on the booking. Bobo did 2.1 km.', '2026-10-20 08:12+07');

-- ---------------------------------------------------------------------------
-- cameras + grants (Ploy boarding window)
-- ---------------------------------------------------------------------------
INSERT INTO public.cameras (
  id, sitter_id, name, stream_url, is_enabled, status, last_seen_at
) VALUES
  ('ca000001-0001-4001-8001-000000000001', 'a2222222-2222-4222-8222-222222222222', 'Living room', 'webrtc:ploy-living', true, 'online', now()),
  ('ca000001-0001-4001-8001-000000000002', 'a2222222-2222-4222-8222-222222222222', 'Garden', 'webrtc:ploy-garden', true, 'online', now()),
  ('ca000001-0001-4001-8001-000000000003', 'a2222222-2222-4222-8222-222222222222', 'Play room', 'webrtc:ploy-play', false, 'offline', now() - interval '2 hours')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_enabled = EXCLUDED.is_enabled,
  status = EXCLUDED.status,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at = now();

INSERT INTO public.camera_access_grants (
  booking_id, owner_id, camera_id, valid_from, valid_to
)
SELECT
  b.id,
  b.owner_id,
  c.id,
  ((b.start_date + b.start_time) AT TIME ZONE 'Asia/Bangkok'),
  ((b.end_date + b.end_time) AT TIME ZONE 'Asia/Bangkok')
FROM public.bookings b
JOIN public.cameras c ON c.sitter_id = b.sitter_id
WHERE b.id = 'b0000001-0001-4001-8001-000000000001'
ON CONFLICT (booking_id, camera_id) DO UPDATE SET
  valid_from = EXCLUDED.valid_from,
  valid_to = EXCLUDED.valid_to;

-- ---------------------------------------------------------------------------
-- walks + points
-- ---------------------------------------------------------------------------
INSERT INTO public.walks (
  id, booking_id, walker_id, pet_ids, status,
  started_at, ended_at, distance_m, duration_s, route_polyline, notes, photos, summary
) VALUES
  (
    'e0000001-0001-4001-8001-000000000001',
    'b0000002-0002-4002-8002-000000000002',
    'a2222222-2222-4222-8222-222222222222',
    ARRAY[1]::bigint[],
    'live',
    '2026-10-30 09:05+07',
    NULL,
    640, 420,
    '13.7308,100.5813|13.7312,100.5820|13.7316,100.5828',
    'Bobo is trotting, first pee stop done.',
    ARRAY['https://picsum.photos/seed/walk3/600/400'],
    NULL
  ),
  (
    'e0000001-0001-4001-8001-000000000002',
    'b0000004-0004-4004-8004-000000000004',
    'a4444444-4444-4444-8444-444444444444',
    ARRAY[1]::bigint[],
    'ended',
    '2026-10-20 07:02+07',
    '2026-10-20 07:48+07',
    2100, 2760,
    '13.7307,100.5418|13.7318,100.5431|13.7324,100.5440|13.7307,100.5418',
    'Calm loop, one poo, no pulling on Rama IV.',
    ARRAY['https://picsum.photos/seed/lumphini/600/400'],
    '2.1 km in 46 min around Lumphini. Bobo stayed on the shade side of the lake and drank once.'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  distance_m = EXCLUDED.distance_m,
  duration_s = EXCLUDED.duration_s,
  summary = EXCLUDED.summary,
  notes = EXCLUDED.notes,
  updated_at = now();

DELETE FROM public.walk_points
WHERE walk_id IN (
  'e0000001-0001-4001-8001-000000000001',
  'e0000001-0001-4001-8001-000000000002'
);

INSERT INTO public.walk_points (walk_id, lat, lng, accuracy, speed, recorded_at) VALUES
  ('e0000001-0001-4001-8001-000000000001', 13.73080, 100.58130, 6.0, 1.4, '2026-10-30 09:05:00+07'),
  ('e0000001-0001-4001-8001-000000000001', 13.73100, 100.58160, 5.5, 1.5, '2026-10-30 09:05:08+07'),
  ('e0000001-0001-4001-8001-000000000001', 13.73120, 100.58200, 5.0, 1.6, '2026-10-30 09:05:16+07'),
  ('e0000001-0001-4001-8001-000000000001', 13.73140, 100.58240, 4.8, 1.5, '2026-10-30 09:05:24+07'),
  ('e0000001-0001-4001-8001-000000000001', 13.73160, 100.58280, 5.2, 1.4, '2026-10-30 09:05:32+07'),
  ('e0000001-0001-4001-8001-000000000002', 13.73070, 100.54180, 4.0, 1.6, '2026-10-20 07:02:00+07'),
  ('e0000001-0001-4001-8001-000000000002', 13.73120, 100.54240, 4.2, 1.7, '2026-10-20 07:10:00+07'),
  ('e0000001-0001-4001-8001-000000000002', 13.73180, 100.54310, 3.8, 1.6, '2026-10-20 07:20:00+07'),
  ('e0000001-0001-4001-8001-000000000002', 13.73240, 100.54400, 4.1, 1.5, '2026-10-20 07:32:00+07'),
  ('e0000001-0001-4001-8001-000000000002', 13.73070, 100.54180, 3.9, 1.3, '2026-10-20 07:48:00+07');

INSERT INTO public.notifications (id, user_id, type, content, is_read) VALUES
  (
    1,
    'a2222222-2222-4222-8222-222222222222',
    'booking_created',
    '{"title":"New booking","body":"Arisa Thong booked you.","href":"/sitter/booking-list/b0000002-0002-4002-8002-000000000002","bookingId":"b0000002-0002-4002-8002-000000000002"}',
    false
  ),
  (
    2,
    'a1111111-1111-4111-8111-111111111111',
    'booking_confirmed',
    '{"title":"Booking confirmed","body":"Ploy S. confirmed your booking.","href":"/owner/bookings","bookingId":"b0000001-0001-4001-8001-000000000001"}',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  is_read = EXCLUDED.is_read;

SELECT setval(pg_get_serial_sequence('public.notifications', 'id'), 2, true);

COMMIT;
