CREATE TABLE hive_user (
 id uuid PRIMARY KEY,
 tenant_id varchar(160) NOT NULL,
 display_name varchar(255) NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_login_at timestamptz,
 UNIQUE(id,tenant_id)
);
CREATE TABLE external_identity (
 issuer varchar(2048) NOT NULL,
 subject varchar(255) NOT NULL,
 user_id uuid NOT NULL REFERENCES hive_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(issuer,subject)
);
CREATE TABLE identity_provider (
 code varchar(80) PRIMARY KEY CHECK(code <> 'primary'),
 name varchar(255) NOT NULL,
 issuer varchar(2048) NOT NULL UNIQUE,
 tenant_id varchar(160) NOT NULL,
 domains text[] NOT NULL,
 client_id varchar(255) NOT NULL,
 secret_reference varchar(255) NOT NULL,
 authorization_endpoint varchar(2048) NOT NULL,
 token_endpoint varchar(2048) NOT NULL,
 jwks_uri varchar(2048) NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);