-- Optional Superset integration. Hive starts and runs without any row here.
-- Each integration and each registered dashboard/chart is also an EXTERNAL_RESOURCE in the catalog, so access is
-- granted with ordinary grants and decided by the authorization graph.
CREATE TABLE superset_integration (
  id uuid PRIMARY KEY,
  integration_key varchar(60) NOT NULL UNIQUE CHECK (integration_key ~ '^[a-z][a-z0-9-]{1,59}$'),
  application_id uuid NOT NULL REFERENCES application(id),
  display_name varchar(255) NOT NULL,
  base_url varchar(2048) NOT NULL,
  tls_required boolean NOT NULL DEFAULT true,
  credential_reference varchar(255) NOT NULL,
  resource_id uuid NOT NULL REFERENCES resource(id),
  enabled boolean NOT NULL DEFAULT true,
  health_status varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK (health_status IN ('UNKNOWN','ACTIVE','UNREACHABLE')),
  health_checked_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE superset_asset (
  integration_id uuid NOT NULL REFERENCES superset_integration(id),
  asset_type varchar(16) NOT NULL CHECK (asset_type IN ('DASHBOARD','CHART')),
  asset_id varchar(64) NOT NULL CHECK (asset_id ~ '^[a-z0-9-]{1,64}$'),
  display_name varchar(255) NOT NULL,
  resource_id uuid NOT NULL REFERENCES resource(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, asset_type, asset_id)
);
