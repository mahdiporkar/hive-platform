# CapRover application releases

`release.yml` sends the exact pushed release-branch commit to the University ERP repository using a short-lived GitHub App token. It never deploys infrastructure, mutates app configuration, or sends a reverse notification. The existing verification workflow remains in place.

All deployment decisions and the cross-repository queue live in `university-erp/.github/workflows/release.yml`; see `university-erp/deploy/README.md` for the runbook. This is deliberately one coordinator in an existing repository, not another platform or repository.

Configure repository variable `RELEASE_APP_ID` and secret `RELEASE_APP_PRIVATE_KEY`: installation access to `mahdiporkar/university-erp`, Contents write (required by GitHub's repository-dispatch endpoint). Restrict the App installation to this repository. Do not use a CapRover administrator password.

Changes to authorization/BFF/console select that image. Starter changes affect both Java Hive services and ERP backend. SDK changes affect console and ERP frontend. Contracts and unknown cross-cutting build changes conservatively select all five applications. Documentation is ignored. The coordinator compares against the last healthy deployed revision, not only the previous push; failed releases are not forgotten.

Java/TypeScript dependencies use exact-commit sibling checkouts and an isolated Maven repository, not a mutable package registry or arbitrary latest source. Therefore no public Maven/npm publication is required. Changed images are published by the coordinator into GHCR with both source SHAs and the run identity, then deployed by digest. Extra Hive jars compiled for ERP end-to-end tests are test fixtures and are never deployed on an ERP-only change.

The approved current Hive branch is `platform-v1`; the remote has no `main` yet. Both workflows use `HIVE_RELEASE_BRANCH` (default `platform-v1`). When migrating through normal review to `main`, set this variable to `main` in both repositories. Both branches are supported by the push trigger, but only the configured branch publishes release requests. All requested SHAs must be reachable from the configured release branch.
