-- Resource catalog, access administration and the OpenFGA projection outbox.
-- PostgreSQL is the source of truth; OpenFGA is a projection written only by this service.

CREATE TABLE resource (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES application(id),
  resource_key varchar(160) NOT NULL CHECK (resource_key ~ '^[a-z][a-z0-9._-]{0,159}$'),
  resource_type varchar(40) NOT NULL CHECK (resource_type IN ('APPLICATION','MODULE','PAGE','UI_COMPONENT','FIELD',
    'BUSINESS_RESOURCE','EXTERNAL_RESOURCE','API_RESOURCE','DATA_RESOURCE','DATA_GOVERNANCE_RESOURCE')),
  parent_id uuid REFERENCES resource(id),
  display_name varchar(255) NOT NULL,
  -- Module that owns the node; NULL for the application root and manual application-level nodes.
  owner_module_key varchar(160),
  origin varchar(16) NOT NULL CHECK (origin IN ('SYSTEM','MANIFEST','MANUAL')),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, resource_key),
  CHECK ((resource_type = 'APPLICATION') = (parent_id IS NULL))
);
CREATE UNIQUE INDEX resource_one_root_per_application ON resource (application_id) WHERE resource_type = 'APPLICATION';

CREATE TABLE resource_action (
  resource_id uuid NOT NULL REFERENCES resource(id),
  action_key varchar(80) NOT NULL CHECK (action_key ~ '^[a-z][a-z0-9_-]{0,79}$' AND action_key <> 'manage'),
  description varchar(500),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, action_key)
);

CREATE TABLE hive_group (
  id uuid PRIMARY KEY,
  group_key varchar(160) NOT NULL UNIQUE CHECK (group_key ~ '^[a-z][a-z0-9._-]{0,159}$'),
  display_name varchar(255) NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE group_member (
  group_id uuid NOT NULL REFERENCES hive_group(id),
  user_id uuid NOT NULL REFERENCES hive_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE hive_role (
  id uuid PRIMARY KEY,
  role_key varchar(160) NOT NULL UNIQUE CHECK (role_key ~ '^[a-z][a-z0-9._-]{0,159}$'),
  display_name varchar(255) NOT NULL,
  description varchar(1000),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE role_assignment (
  id uuid PRIMARY KEY,
  role_id uuid NOT NULL REFERENCES hive_role(id),
  subject_type varchar(8) NOT NULL CHECK (subject_type IN ('USER','GROUP')),
  subject_id uuid NOT NULL,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by varchar(255)
);
CREATE UNIQUE INDEX role_assignment_active ON role_assignment (role_id, subject_type, subject_id) WHERE revoked_at IS NULL;

CREATE TABLE permission_grant (
  id uuid PRIMARY KEY,
  subject_type varchar(8) NOT NULL CHECK (subject_type IN ('USER','ROLE','GROUP')),
  subject_id uuid NOT NULL,
  resource_id uuid NOT NULL REFERENCES resource(id),
  action_key varchar(80) NOT NULL,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by varchar(255)
);
CREATE UNIQUE INDEX permission_grant_active ON permission_grant (subject_type, subject_id, resource_id, action_key) WHERE revoked_at IS NULL;

CREATE TABLE platform_role_assignment (
  id uuid PRIMARY KEY,
  platform_role varchar(24) NOT NULL CHECK (platform_role IN ('SUPER_ADMIN','OPERATOR','SECURITY_ADMIN','INTEGRATION_ADMIN','AUDITOR')),
  subject_type varchar(8) NOT NULL CHECK (subject_type IN ('USER','ROLE','GROUP')),
  subject_id uuid NOT NULL,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by varchar(255)
);
CREATE UNIQUE INDEX platform_role_assignment_active ON platform_role_assignment (platform_role, subject_type, subject_id) WHERE revoked_at IS NULL;

-- Ordered, at-least-once projection of relational changes into OpenFGA.
CREATE TABLE graph_outbox (
  id bigserial PRIMARY KEY,
  operation varchar(8) NOT NULL CHECK (operation IN ('WRITE','DELETE')),
  subject varchar(400) NOT NULL,
  relation varchar(80) NOT NULL,
  object varchar(400) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(1000),
  claimed_at timestamptz,
  claim_owner uuid,
  processed_at timestamptz,
  dead_lettered_at timestamptz
);
CREATE INDEX graph_outbox_pending ON graph_outbox (id) WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX graph_outbox_tuple ON graph_outbox (subject, relation, object) WHERE processed_at IS NULL;

-- One OpenFGA store per deployment, created under an advisory lock by the first instance.
CREATE TABLE graph_store (
  store_name varchar(64) PRIMARY KEY,
  store_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One-time bootstrap markers. Completion is durable so that revoking the first administrator is final.
CREATE TABLE platform_bootstrap (
  bootstrap_key varchar(80) PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL
);

ALTER TABLE application ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE application ADD CONSTRAINT application_key_format CHECK (application_key ~ '^[a-z][a-z0-9-]{1,79}$');
