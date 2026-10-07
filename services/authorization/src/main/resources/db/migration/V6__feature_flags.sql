-- Generic boolean feature flags: safe default (off), environment restriction, tenant/application overrides, audited changes.
CREATE TABLE feature_flag (
  flag_key varchar(120) PRIMARY KEY CHECK (flag_key ~ '^[a-z][a-zA-Z0-9.-]{1,119}$'),
  description varchar(500) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  exposure varchar(16) NOT NULL CHECK (exposure IN ('PUBLIC','AUTHENTICATED','INTERNAL')),
  environments text[] NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feature_flag_override (
  flag_key varchar(120) NOT NULL REFERENCES feature_flag(flag_key),
  scope varchar(16) NOT NULL CHECK (scope IN ('TENANT','APPLICATION')),
  scope_value varchar(160) NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, scope, scope_value)
);
