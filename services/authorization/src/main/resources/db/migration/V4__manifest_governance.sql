-- Module (Micro App) registry, immutable artifact and resource-manifest revisions, release history and navigation overlays.

CREATE TABLE micro_app (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES application(id),
  module_key varchar(80) NOT NULL UNIQUE CHECK (module_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  display_name varchar(255) NOT NULL,
  definition_mode varchar(8) NOT NULL CHECK (definition_mode IN ('MANIFEST','MANUAL','HYBRID')),
  mf_manifest_url varchar(2048),
  resource_manifest_url varchar(2048),
  active_artifact_id uuid,
  active_resource_revision_id uuid,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resource_manifest_revision (
  id uuid PRIMARY KEY,
  micro_app_id uuid NOT NULL REFERENCES micro_app(id),
  manifest_version varchar(64) NOT NULL,
  schema_version varchar(32) NOT NULL,
  checksum char(64) NOT NULL,
  document jsonb NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('DRAFT','PUBLISHED')),
  source varchar(8) NOT NULL CHECK (source IN ('UPLOAD','FETCH')),
  source_url varchar(2048),
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by varchar(255),
  published_at timestamptz,
  UNIQUE (micro_app_id, manifest_version)
);

-- Published revisions are immutable: content, checksum and publication metadata can never change, and they cannot be deleted.
CREATE FUNCTION hive_reject_published_manifest_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'published manifest revisions are immutable' USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'published manifest revisions are immutable' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NEW.document IS DISTINCT FROM OLD.document OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW.manifest_version IS DISTINCT FROM OLD.manifest_version THEN
    RAISE EXCEPTION 'manifest revision content is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_manifest_revision_immutable BEFORE UPDATE OR DELETE ON resource_manifest_revision
  FOR EACH ROW EXECUTE FUNCTION hive_reject_published_manifest_change();

CREATE TABLE artifact_revision (
  id uuid PRIMARY KEY,
  micro_app_id uuid NOT NULL REFERENCES micro_app(id),
  manifest_version varchar(64) NOT NULL,
  schema_version varchar(32) NOT NULL,
  contract_version varchar(32) NOT NULL,
  runtime_version varchar(32) NOT NULL,
  resource_manifest_version varchar(64),
  artifact_url varchar(2048) NOT NULL,
  integrity varchar(200) NOT NULL,
  checksum char(64) NOT NULL,
  document jsonb NOT NULL,
  source varchar(8) NOT NULL CHECK (source IN ('UPLOAD','FETCH')),
  source_url varchar(2048),
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (micro_app_id, manifest_version)
);
CREATE FUNCTION hive_reject_artifact_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'artifact revisions are immutable' USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER artifact_revision_immutable BEFORE UPDATE OR DELETE ON artifact_revision
  FOR EACH ROW EXECUTE FUNCTION hive_reject_artifact_change();

ALTER TABLE micro_app ADD CONSTRAINT micro_app_active_artifact FOREIGN KEY (active_artifact_id) REFERENCES artifact_revision(id);
ALTER TABLE micro_app ADD CONSTRAINT micro_app_active_resources FOREIGN KEY (active_resource_revision_id) REFERENCES resource_manifest_revision(id);

CREATE TABLE module_release (
  id uuid PRIMARY KEY,
  sequence bigserial NOT NULL UNIQUE,
  micro_app_id uuid NOT NULL REFERENCES micro_app(id),
  action varchar(24) NOT NULL CHECK (action IN ('RESOURCES_PUBLISHED','RESOURCES_ACTIVATED','ARTIFACT_ACTIVATED','DEACTIVATED')),
  resource_revision_id uuid REFERENCES resource_manifest_revision(id),
  artifact_revision_id uuid REFERENCES artifact_revision(id),
  summary jsonb NOT NULL,
  actor varchar(255) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX module_release_history ON module_release (micro_app_id, sequence);

-- Navigation overlays adjust presentation of declared routes only; they never affect authorization.
CREATE TABLE navigation_overlay (
  micro_app_id uuid NOT NULL REFERENCES micro_app(id),
  route_key varchar(80) NOT NULL,
  label varchar(255),
  sort_order integer,
  hidden boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (micro_app_id, route_key)
);

-- Monotonic counter the BFF uses to invalidate its runtime catalog cache.
CREATE SEQUENCE runtime_catalog_revision;
