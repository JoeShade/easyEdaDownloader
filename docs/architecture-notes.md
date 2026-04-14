# Architecture Notes

This file records short implementation notes that supplement, but do not replace, [systemDesign.md](../systemDesign.md).

## Layer boundaries

- `src/content_script.js`: DOM inspection and provider-aware part-context detection only
- `src/popup.js`: popup UI state, settings, preview requests, Firefox SamacSys relay gating, relay-auth input, captured-auth status, and export requests
- `src/service_worker.js`: thin runtime entrypoint only
- `src/service_worker_runtime.js`: provider routing, runtime gating, Firefox SamacSys auth capture, automatic auth-refresh orchestration, response shaping, and composition of worker dependencies
- `src/core/*.js`: shared worker business logic for settings, downloads, storage-backed symbol-library handling, shared export artifact writing, and common normalization
- `src/sources/*.js`: source adapters plus source-specific fetch/parse/export helpers
  - `src/sources/samacsys_distributor_adapter.js` is the shared backend adapter for Mouser and Farnell
- `src/sources/samacsys_common.js` holds the shared SamacSys preview, ZIP, relay-cookie, relay-auth, upstream-auth, and asset-rewrite helpers
- `src/kicad_converter.js`: stable public converter facade
- `src/kicad/*.js`: EasyEDA parsing, KiCad text generation, shared conversion math, and OBJ-to-WRL conversion
- `src/vendor/zip_reader.js`: minimal runtime ZIP extraction for SamacSys archives

## Testability notes

- `src/kicad_converter.js` should stay the stable facade for converter tests, while pure conversion details live under `src/kicad/`.
- `src/content_script.js` should stay small and DOM-driven so it can be exercised with markup fixtures.
- `src/popup.js` should keep browser messaging and DOM updates visible enough to test with mocked `chrome.*` APIs.
- `src/service_worker_runtime.js` should hold browser-dependent orchestration, with tests using mocks instead of browser-run end-to-end flows.
- Source-specific helpers should be testable directly without exposing router internals just for test coverage.

## Current implementation caveats worth preserving

- The popup does not fetch, extract, or convert CAD assets directly; it only requests that work.
- The runtime/router owns provider branching, while source adapters own source-specific preview and export behavior.
- Farnell does not have its own backend adapter file because it intentionally reuses the shared SamacSys distributor backend.
- Symbol library append behavior depends on `chrome.storage.local`, not on local filesystem reads.
- Library-mode download paths remain relative to Downloads and are resolved from popup settings, not absolute filesystem paths.
- SamacSys distributor support is still Chrome-first, but Firefox can opt into a user-managed relay through popup settings.
- Firefox relay mode forwards matching `componentsearchengine.com` cookies so authenticated SamacSys ZIP downloads can reuse the browser session instead of teaching the relay to log in.
- Firefox relay mode can also generate the upstream SamacSys HTTP Basic auth header locally from optional stored username/password credentials, avoiding any dependency on a browser-captured header when the user prefers that setup.
- Firefox now stores the latest observed upstream SamacSys `Authorization` header through `webRequest` and reuses it for proxied Firefox requests until a newer one is captured.
- Relay auth and upstream SamacSys auth are separate: relay auth is sent only on the Worker POST, while upstream auth is forwarded inside the relay payload.
- SamacSys ZIP-export `401` responses are mapped to a sign-in-required error because upstream authentication can be stricter for downloads than for previews.
- On Firefox relay mode, one failed SamacSys ZIP export can trigger a single auth-refresh attempt, then a single retry with the newly captured upstream auth.
- The current repository is intentionally compact; add new sources through focused adapters or distributor detection changes rather than introducing a broader application framework.
- The manifest intentionally declares both `background.service_worker` and `background.scripts` so Chrome can run the service worker while Firefox falls back to a background document on Firefox 121+.
