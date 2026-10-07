# ADR-010: Enforced framework neutrality

Status: accepted.

Contracts contain DOM and data interfaces only. A Micro App exports a factory that creates independent lifecycle instances. This refines the requested mount/unmount example so concurrent instances cannot share an implicit singleton unmount operation. React adapters remain separate packages.

TypeScript AST inspection checks static imports, re-exports, inline type imports, literal dynamic imports and CommonJS requires in headless modules. Dependency manifests include peer and development dependencies in the same prohibition. Java core imports cannot point at consumer or solution namespaces. Domain identifiers are checked only in platform implementation, allowing explicit fixtures.

These are regression boundaries, not a security sandbox for arbitrary third-party code. A subsequent MFE runtime phase must test loading and concurrent cleanup.