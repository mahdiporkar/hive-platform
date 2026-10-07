# ADR-002: Control and runtime planes

Status: accepted; bootstrap implementation only.

Authorization owns control-plane persistence and the authorization graph writer. BFF owns browser sessions and runtime transport. Consumers must communicate through APIs and cannot directly mutate persistence or graph relationships.

The executable bootstrap test runs both Java services without consumers, using isolated PostgreSQL databases for control-plane and OpenFGA state. Model creation and default-deny behavior are tested, including model persistence across an OpenFGA restart. The graph's absence makes authorization readiness fail; liveness remains available.

The Compose file is a local verification topology. Production network boundaries, credentials and deployment artifacts belong to Phase 13. All feature endpoints remain denied until their security phases implement them.