-- Dynamic routing: trusted service targets, legacy authentication profiles (secret references only), proxy routes,
-- route operations bound to resource actions, and the API log.

CREATE TABLE service_target (
  id uuid PRIMARY KEY,
  target_key varchar(80) NOT NULL UNIQUE CHECK (target_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  display_name varchar(255) NOT NULL,
  base_url varchar(2048) NOT NULL,
  connect_timeout_ms integer NOT NULL CHECK (connect_timeout_ms BETWEEN 100 AND 30000),
  response_timeout_ms integer NOT NULL CHECK (response_timeout_ms BETWEEN 100 AND 120000),
  max_request_bytes integer NOT NULL CHECK (max_request_bytes BETWEEN 0 AND 52428800),
  max_response_bytes integer NOT NULL CHECK (max_response_bytes BETWEEN 1 AND 52428800),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legacy_auth_profile (
  id uuid PRIMARY KEY,
  profile_key varchar(80) NOT NULL UNIQUE CHECK (profile_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  service_target_id uuid NOT NULL REFERENCES service_target(id),
  token_endpoint_path varchar(512) NOT NULL,
  request_format varchar(24) NOT NULL CHECK (request_format IN ('JSON','FORM_URLENCODED','HTTP_BASIC','OAUTH_CLIENT_CREDENTIALS')),
  -- Reference resolved by the BFF only (env:HIVE_SECRET_* or file:<name>); credentials never enter this database.
  credential_reference varchar(255) NOT NULL,
  token_pointer varchar(255) NOT NULL,
  expires_in_pointer varchar(255) NOT NULL,
  token_type_pointer varchar(255),
  scheme varchar(32) NOT NULL DEFAULT 'Bearer',
  scope varchar(512),
  audience varchar(512),
  expiry_skew_seconds integer NOT NULL CHECK (expiry_skew_seconds BETWEEN 0 AND 3600),
  max_response_bytes integer NOT NULL DEFAULT 65536 CHECK (max_response_bytes BETWEEN 256 AND 1048576),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proxy_route (
  id uuid PRIMARY KEY,
  route_key varchar(80) NOT NULL UNIQUE CHECK (route_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  application_id uuid NOT NULL REFERENCES application(id),
  micro_app_id uuid REFERENCES micro_app(id),
  path_prefix varchar(500) NOT NULL UNIQUE,
  service_target_id uuid NOT NULL REFERENCES service_target(id),
  authentication varchar(16) NOT NULL CHECK (authentication IN ('NONE','FORWARD_TOKEN','LEGACY')),
  legacy_profile_id uuid REFERENCES legacy_auth_profile(id),
  upstream_base_path varchar(500) NOT NULL DEFAULT '/',
  strip_prefix boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((authentication = 'LEGACY') = (legacy_profile_id IS NOT NULL))
);

CREATE TABLE route_operation (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES proxy_route(id),
  operation_key varchar(80) NOT NULL CHECK (operation_key ~ '^[a-z][a-z0-9-]{0,79}$'),
  http_method varchar(8) NOT NULL CHECK (http_method IN ('GET','HEAD','POST','PUT','PATCH','DELETE')),
  path_pattern varchar(500) NOT NULL,
  access varchar(16) NOT NULL CHECK (access IN ('PUBLIC','HYBRID','AUTHENTICATED')),
  resource_id uuid REFERENCES resource(id),
  action_key varchar(80),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, operation_key),
  -- Protected operations always name the resource action that authorizes them; anonymous ones never do.
  CHECK ((access = 'AUTHENTICATED') = (resource_id IS NOT NULL AND action_key IS NOT NULL))
);
CREATE UNIQUE INDEX route_operation_active ON route_operation (route_id, http_method, path_pattern) WHERE NOT archived;

CREATE TABLE api_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id varchar(128) NOT NULL,
  actor_id varchar(255),
  http_method varchar(8) NOT NULL,
  route_key varchar(80),
  operation_key varchar(80),
  path_template varchar(600),
  status integer NOT NULL,
  upstream_status integer,
  duration_ms integer NOT NULL,
  outcome varchar(16) NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','UNAUTHENTICATED','NOT_FOUND','UPSTREAM_ERROR','REJECTED')),
  reason varchar(64)
);
CREATE INDEX api_log_time ON api_log (occurred_at DESC);
CREATE INDEX api_log_correlation ON api_log (correlation_id);
