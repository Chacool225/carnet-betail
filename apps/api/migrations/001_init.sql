-- Carnet Bétail : schéma complet (lots 1 à 5). Écrit par P1 le jour 0, verrouillé ensuite.

-- ---------- Zones et comptes ----------
CREATE TABLE zones (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  lat  DOUBLE PRECISION,
  lng  DOUBLE PRECISION
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            TEXT NOT NULL CHECK (role IN ('eleveur', 'vet', 'agent', 'autorite')),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  phone           TEXT NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{10}$'),
  email           TEXT UNIQUE CHECK (email = lower(email)),
  password_hash   TEXT NOT NULL,
  pin_hash        TEXT,
  zone_id         UUID REFERENCES zones (id),
  photo_url       TEXT,
  prefs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_zone_idx ON users (zone_id);

CREATE TABLE vets (
  user_id      UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  order_number TEXT NOT NULL UNIQUE,
  clinic       TEXT,
  verified     BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family      UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family);

-- Rejeu des écritures envoyées deux fois (en-tête Idempotency-Key).
CREATE TABLE idempotency_keys (
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status       INTEGER,
  body         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---------- Animaux et lots ----------
CREATE SEQUENCE animal_code_seq START 1000;

CREATE TABLE animals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('individual', 'lot')),
  species         TEXT NOT NULL CHECK (species IN ('bovin', 'ovin', 'caprin', 'porcin', 'volaille', 'lapin', 'poisson')),
  breed           TEXT,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  sex             TEXT CHECK (sex IN ('M', 'F')),
  born_on         DATE,
  owner_id        UUID NOT NULL REFERENCES users (id),
  zone_id         UUID NOT NULL REFERENCES zones (id),
  status          TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'vendu', 'abattu', 'decede', 'vole')),
  qty             INTEGER CHECK (qty >= 0),            -- RG5 : jamais négatif
  qty_initial     INTEGER CHECK (qty_initial >= 0),
  avg_weight_kg   NUMERIC(7, 2) CHECK (avg_weight_kg > 0),
  rfid            TEXT UNIQUE,                         -- RG8 : une boucle, une seule fiche
  photo_url       TEXT,
  listed_at       TIMESTAMPTZ,
  listing_price   BIGINT CHECK (listing_price >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- un lot a un effectif, un animal seul n'en a pas
  CONSTRAINT animals_kind_qty CHECK (
    (kind = 'lot' AND qty IS NOT NULL AND qty_initial IS NOT NULL)
    OR (kind = 'individual' AND qty IS NULL AND qty_initial IS NULL)
  )
);
CREATE INDEX animals_owner_idx ON animals (owner_id);
CREATE INDEX animals_zone_idx ON animals (zone_id);
CREATE INDEX animals_status_idx ON animals (status);

CREATE TABLE animal_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id  UUID NOT NULL REFERENCES animals (id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX animal_photos_animal_idx ON animal_photos (animal_id);

-- ---------- Santé (historique en ajout seul, voir 002) ----------
CREATE TABLE health_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id         UUID NOT NULL REFERENCES animals (id),
  type              TEXT NOT NULL CHECK (type IN ('vaccin', 'soin', 'controle')),
  label             TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  done_on           DATE NOT NULL,
  next_due_on       DATE,
  withdrawal_days   INTEGER CHECK (withdrawal_days >= 0),   -- RG6 : délai d'attente avant vente
  vet_id            UUID REFERENCES users (id),             -- renseigné si l'acte est signé par un vétérinaire
  recorded_by       UUID NOT NULL REFERENCES users (id),
  note              TEXT,
  corrects_event_id UUID REFERENCES health_events (id),     -- RG2 : une erreur se corrige par un nouvel acte
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX health_events_animal_idx ON health_events (animal_id, done_on DESC);

CREATE TABLE cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id      UUID NOT NULL REFERENCES animals (id),
  diseases       TEXT[] NOT NULL CHECK (array_length(diseases, 1) >= 1),
  affected_count INTEGER NOT NULL CHECK (affected_count >= 1),
  severity       TEXT NOT NULL CHECK (severity IN ('legere', 'moyenne', 'grave')),
  symptoms       TEXT[] NOT NULL DEFAULT '{}',
  note           TEXT,
  deaths         INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  status         TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'suivi', 'gueri', 'clos')),
  opened_on      DATE NOT NULL DEFAULT current_date,
  closed_on      DATE,
  opened_by      UUID NOT NULL REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cases_animal_idx ON cases (animal_id);
CREATE INDEX cases_status_idx ON cases (status);

CREATE TABLE flows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id         UUID NOT NULL REFERENCES animals (id),
  type              TEXT NOT NULL CHECK (type IN ('entree', 'mortalite', 'vente', 'vol', 'abattage', 'pesee', 'identification')),
  qty               INTEGER CHECK (qty >= 0),
  counterpart       TEXT,
  weight_kg         NUMERIC(7, 2) CHECK (weight_kg > 0),
  related_animal_id UUID REFERENCES animals (id),
  note              TEXT,
  occurred_on       DATE NOT NULL DEFAULT current_date,
  recorded_by       UUID NOT NULL REFERENCES users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX flows_animal_idx ON flows (animal_id, occurred_on DESC);

-- ---------- Accès, transferts, alertes, audit ----------
CREATE TABLE access_grants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id  UUID NOT NULL REFERENCES animals (id),
  vet_id     UUID NOT NULL REFERENCES users (id),
  source     TEXT NOT NULL CHECK (source IN ('scan', 'soin', 'invitation', 'enregistrement')),
  granted_on DATE NOT NULL DEFAULT current_date,
  expires_on DATE NOT NULL,                       -- RG1 : 30 jours, renouvelé par scan ou soin
  revoked_on DATE,
  CHECK (expires_on >= granted_on)
);
-- un seul accès non retiré par couple animal / vétérinaire (renouvelé plutôt que dupliqué)
CREATE UNIQUE INDEX access_grants_active_uq ON access_grants (animal_id, vet_id) WHERE revoked_on IS NULL;
CREATE INDEX access_grants_vet_idx ON access_grants (vet_id);

CREATE TABLE transfers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id   UUID NOT NULL REFERENCES animals (id),
  from_user   UUID NOT NULL REFERENCES users (id),
  to_user     UUID NOT NULL REFERENCES users (id),
  occurred_on DATE NOT NULL DEFAULT current_date,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user <> to_user)
);
CREATE INDEX transfers_animal_idx ON transfers (animal_id);

CREATE TABLE alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('vol', 'sanitaire', 'anomalie')),
  severity   TEXT NOT NULL CHECK (severity IN ('haute', 'moyenne', 'basse')),
  zone_id    UUID REFERENCES zones (id),
  animal_id  UUID REFERENCES animals (id),
  title      TEXT NOT NULL,
  why        TEXT,
  created_on DATE NOT NULL DEFAULT current_date,
  handled_by UUID REFERENCES users (id),
  handled_at TIMESTAMPTZ
);
CREATE INDEX alerts_zone_idx ON alerts (zone_id, created_on DESC);

CREATE TABLE audit_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id  UUID REFERENCES users (id),
  animal_id UUID REFERENCES animals (id),
  action    TEXT NOT NULL,
  detail    JSONB,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_animal_idx ON audit_log (animal_id, at DESC);

-- Opérations envoyées depuis le téléphone (POST /sync, lot 5) : un client_id = une seule exécution (RG9).
CREATE TABLE client_ops (
  client_id  UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users (id),
  type       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  result     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
