-- Lot 6 : achat par un particulier, notifications, photos envoyées depuis le téléphone.

-- Nouveau rôle : le particulier (acheteur). Il peut posséder les animaux qu'il achète.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('eleveur', 'vet', 'agent', 'autorite', 'particulier'));

CREATE TABLE purchase_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id     UUID NOT NULL REFERENCES animals (id),
  buyer_id      UUID NOT NULL REFERENCES users (id),
  seller_id     UUID NOT NULL REFERENCES users (id),
  message       TEXT CHECK (char_length(message) <= 500),
  offered_price BIGINT CHECK (offered_price >= 0),
  agreed_price  BIGINT CHECK (agreed_price >= 0),
  status        TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'acceptee', 'refusee', 'annulee', 'conclue')),
  seller_note   TEXT CHECK (char_length(seller_note) <= 500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  CHECK (buyer_id <> seller_id)
);
-- une seule demande en cours par acheteur et par animal
CREATE UNIQUE INDEX purchase_requests_active_uq ON purchase_requests (animal_id, buyer_id) WHERE status IN ('en_attente', 'acceptee');
CREATE INDEX purchase_requests_seller_idx ON purchase_requests (seller_id, created_at DESC);
CREATE INDEX purchase_requests_buyer_idx ON purchase_requests (buyer_id, created_at DESC);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  dedupe_key TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Contenu des photos envoyées (JPEG, PNG ou WebP, en base 64 pour rester identique sur PostgreSQL et PGlite).
CREATE TABLE photo_files (
  photo_id     UUID PRIMARY KEY REFERENCES animal_photos (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data_b64     TEXT NOT NULL
);
