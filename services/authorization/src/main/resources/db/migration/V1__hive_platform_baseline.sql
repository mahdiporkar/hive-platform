CREATE TABLE platform_configuration (
  configuration_key varchar(160) PRIMARY KEY,
  value jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application (
  id uuid PRIMARY KEY,
  application_key varchar(160) NOT NULL UNIQUE,
  display_name varchar(255) NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_event (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id varchar(255),
  event_type varchar(160) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  outcome varchar(16) NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  details jsonb NOT NULL
);
CREATE INDEX audit_event_time_idx ON audit_event (occurred_at DESC);