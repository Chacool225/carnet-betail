-- Lot 7 : vente à l'unité avec prix dégressif, négociation par messages, profil d'acheteur.

-- ---------- Annonce : quantité mise en vente, prix à l'unité, palier dégressif ----------
ALTER TABLE animals ADD COLUMN listing_qty   INTEGER CHECK (listing_qty >= 1);
ALTER TABLE animals ADD COLUMN bulk_min_qty  INTEGER CHECK (bulk_min_qty >= 2);
ALTER TABLE animals ADD COLUMN bulk_price    BIGINT CHECK (bulk_price >= 0);
ALTER TABLE animals ADD COLUMN split_from    UUID REFERENCES animals (id);
ALTER TABLE animals ADD CONSTRAINT animals_bulk_pair CHECK ((bulk_min_qty IS NULL) = (bulk_price IS NULL));
ALTER TABLE animals ADD CONSTRAINT animals_bulk_lower CHECK (bulk_price IS NULL OR listing_price IS NULL OR bulk_price < listing_price);

-- Les annonces déjà publiées portent sur tout l'effectif.
UPDATE animals SET listing_qty = COALESCE(qty, 1) WHERE listed_at IS NOT NULL;

-- Quand une annonce est retirée (vente, abattage, vol, transfert…), sa quantité et son palier disparaissent avec elle.
CREATE FUNCTION clear_listing_details() RETURNS trigger AS $$
BEGIN
  IF NEW.listed_at IS NULL THEN
    NEW.listing_qty := NULL;
    NEW.bulk_min_qty := NULL;
    NEW.bulk_price := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER animals_clear_listing BEFORE INSERT OR UPDATE ON animals
  FOR EACH ROW EXECUTE FUNCTION clear_listing_details();

-- ---------- Demandes : quantité, propositions de chaque partie, accord ----------
ALTER TABLE purchase_requests ADD COLUMN qty               INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1);
ALTER TABLE purchase_requests ADD COLUMN agreed_qty        INTEGER CHECK (agreed_qty >= 1);
ALTER TABLE purchase_requests ADD COLUMN buyer_qty         INTEGER CHECK (buyer_qty >= 1);
ALTER TABLE purchase_requests ADD COLUMN buyer_unit_price  BIGINT CHECK (buyer_unit_price >= 0);
ALTER TABLE purchase_requests ADD COLUMN seller_qty        INTEGER CHECK (seller_qty >= 1);
ALTER TABLE purchase_requests ADD COLUMN seller_unit_price BIGINT CHECK (seller_unit_price >= 0);
UPDATE purchase_requests SET buyer_qty = 1, buyer_unit_price = COALESCE(offered_price, agreed_price),
  agreed_qty = CASE WHEN status IN ('acceptee', 'conclue') THEN 1 END;

-- ---------- Conversation d'une demande ----------
CREATE TABLE purchase_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
  sender_id  UUID REFERENCES users (id),                 -- NULL pour un message du système
  kind       TEXT NOT NULL CHECK (kind IN ('text', 'proposal', 'recap', 'system')),
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  qty        INTEGER,
  unit_price BIGINT,
  total      BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX purchase_messages_req_idx ON purchase_messages (request_id, created_at, id);

-- ---------- Profil d'acheteur (profession ou organisation représentée) ----------
CREATE TABLE buyer_profiles (
  user_id       UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  profession    TEXT CHECK (char_length(profession) <= 80),
  org_kind      TEXT CHECK (org_kind IN ('restaurant', 'hotel', 'boucherie', 'traiteur', 'cooperative', 'marche', 'autre')),
  org_name      TEXT CHECK (char_length(org_name) <= 120),
  contact_name  TEXT CHECK (char_length(contact_name) <= 80),
  contact_phone TEXT CHECK (contact_phone ~ '^[0-9]{10}$'),
  locality      TEXT CHECK (char_length(locality) <= 120),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- une organisation a au moins un nom
  CHECK (org_kind IS NULL OR org_name IS NOT NULL)
);
