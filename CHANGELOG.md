# Changelog

Notable changes are recorded here in reverse chronological order.

## Unreleased

This section summarizes the current `Development` branch compared with `main` as reviewed on 2026-05-08.

### Added

- Added Mouser SamacSys support for part detection, preview loading, upstream KiCad ZIP download, and KiCad library or loose-file export.
- Added Farnell SamacSys support through the shared SamacSys distributor flow.
- Added Firefox SamacSys relay support for preview and export requests through a user-managed relay URL.
- Added SamacSys authentication settings for relay auth, upstream username/password Basic auth generation, manual upstream `Authorization` override, captured Firefox upstream auth reuse, and one automatic Firefox auth-refresh retry after ZIP `401` responses.
- Added a configurable Downloads-relative KiCad library folder.
- Added runtime ZIP extraction for SamacSys archives, including KiCad symbols, footprints, STEP models, and WRL files already present in the archive.
- Added `systemDesign.md`, architecture notes, Firefox relay documentation, contribution guidance, and security reporting documentation.
- Added a Node/Vitest regression suite covering content-script detection, popup behavior, service-worker orchestration, EasyEDA conversion, and repository hygiene.
- Added CI, ESLint, dependency audit, `npm run validate`, `.nvmrc`, and `package-lock.json` for repeatable local and GitHub Actions validation.
- Added repository hygiene checks for source footers, governance docs, validation wiring, high-confidence secret patterns, generated archives, local environment files, logs, editor files, and temporary files.
- Added repository hygiene checks for conventional file naming, lower camelCase function declarations, and maintained-file line-count limits.

### Changed

- Split the service worker into a thin Manifest V3 entrypoint plus a runtime/router module with source adapters and shared core helpers.
- Split the EasyEDA-to-KiCad converter into focused parser, emitter, shared conversion, and OBJ-to-WRL modules while keeping `src/kicad_converter.js` as the public facade.
- Split the oversized service-worker regression file into focused core, EasyEDA, direct SamacSys, and Firefox SamacSys test files backed by a shared harness.
- Reworked the popup into a provider-aware UI that shows fixed manufacturer metadata plus source-specific part metadata and advanced SamacSys/Firefox settings.
- Moved persistent download layout, Firefox relay, and SamacSys auth settings from the popup into a dedicated extension settings page.
- Updated the manifest for Chrome service-worker operation and Firefox background-document fallback on Firefox `121+`.
- Updated README and project docs to describe supported providers, setup, settings, auth behavior, browser support, validation, and repository layout.

### Fixed

- Improved provider-aware page detection for JLCPCB, LCSC, Mouser, and Farnell product pages.
- Preserved SamacSys KiCad library relationships by rewriting symbol footprint properties and footprint model paths in library mode.
- Handled SamacSys ZIP structures where `KiCad/` and `3D/` folders appear either at the archive root or under a part-specific parent folder.
- Reworked SamacSys ZIP `401` handling into clearer sign-in-required errors and retry behavior.
- Kept relay auth separate from upstream SamacSys auth so relay credentials are not forwarded to upstream providers.
- Removed real-looking SamacSys auth values from tests and fixtures.

### Security

- Documented credential storage, relay responsibility, vulnerability reporting, and stored credential clearing in `SECURITY.md`.
- Added automated checks for common secret/token formats and private-key material in text files.
- Added ignore rules and hygiene checks for local secret files, generated extension archives, logs, editor backups, OS metadata, and temporary files.
