-- Custom migration (ADR-008, ADR-005, CLAUDE.md rule 4): an approved report version is frozen.
-- Allowed: approving an unapproved version, or editing it in place while unapproved.
-- Refused: any UPDATE or DELETE of a row whose approved_at is already set.
CREATE FUNCTION "report_versions_freeze_approved"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approved_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Report version % is approved and cannot be changed or deleted', OLD."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'report_versions_freeze_approved';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "report_versions_freeze_approved"
  BEFORE UPDATE OR DELETE ON "report_versions"
  FOR EACH ROW EXECUTE FUNCTION "report_versions_freeze_approved"();
