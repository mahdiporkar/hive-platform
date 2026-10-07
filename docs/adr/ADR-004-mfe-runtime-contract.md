# ADR-004: Instance-producing Micro App ABI

Status: accepted contract; runtime not implemented yet.

Export a versioned HiveMicroApp factory with create(), returning independent mount/unmount/update instances. Each mount receives a scoped event port, instance/slot identifiers, immutable context data and an AbortSignal. Core does not import React or any UI renderer.

This prevents a shared module object from accidentally unmounting another instance. Resource manifests and artifact manifests are separate types. Dynamic loading must validate compatibility before executing the lifecycle. Runtime isolation tests are required in Phase 7.