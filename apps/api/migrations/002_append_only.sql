-- RG2 : l'historique ne se modifie ni ne se supprime, au niveau de la base elle-même.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_events_append_only BEFORE UPDATE OR DELETE ON health_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER flows_append_only BEFORE UPDATE OR DELETE ON flows
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER transfers_append_only BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
