-- Custom migration (ADR-005, CLAUDE.md rule 4): an approved version is frozen.
-- Allowed: approving an unapproved version, or editing it in place while unapproved.
-- Refused: any UPDATE or DELETE of a row whose approved_at is already set.
CREATE FUNCTION "versions_freeze_approved"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approved_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Version % is approved and cannot be changed or deleted', OLD."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'versions_freeze_approved';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "versions_freeze_approved"
  BEFORE UPDATE OR DELETE ON "versions"
  FOR EACH ROW EXECUTE FUNCTION "versions_freeze_approved"();
