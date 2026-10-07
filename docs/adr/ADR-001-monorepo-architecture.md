# ADR-001: Independent monorepo

Status: accepted for bootstrap.

Use a fresh Git history, Java 21 / Spring Boot services and separately versioned framework-neutral TypeScript packages. The control-plane service owns PostgreSQL migrations. Consumers are optional and may not become mandatory service dependencies. No source migration history or demo seeds are imported.

The first milestone deliberately exposes only health endpoints, with all other requests denied. A successful bootstrap is not evidence of implemented identity, authorization or administrative APIs. Those capabilities have separate phase gates.

Verification: repository identity tests, HTTP security tests, fresh database migration and zero-consumer startup test.