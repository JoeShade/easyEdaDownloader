# Architecture Notes

This file records short implementation notes that supplement, but do not replace, [systemDesign.md](../systemDesign.md).

## Layer boundaries

- `src/content_script.js`: DOM inspection and provider-aware part-context detection only
- `src/popup.js`: popup UI state, settings, preview requests, Firefox Mouser gating, and export requests
- `src/service_worker.js`: provider-aware network fetches, preview generation, symbol-library merging, ZIP extraction, and downloads
- `src/kicad_converter.js`: EasyEDA parsing, KiCad text generation, and OBJ-to-WRL conversion
- `src/vendor/zip_reader.js`: minimal runtime ZIP extraction for SamacSys archives

## Testability notes

- `src/kicad_converter.js` is the main pure logic boundary and should stay the easiest module to unit test directly.
- `src/content_script.js` should stay small and DOM-driven so it can be exercised with markup fixtures.
- `src/popup.js` should keep browser messaging and DOM updates visible enough to test with mocked `chrome.*` APIs.
- `src/service_worker.js` should keep browser-dependent orchestration there, with tests using mocks instead of browser-run end-to-end flows.

## Current implementation caveats worth preserving

- The popup does not fetch, extract, or convert CAD assets directly; it only requests that work.
- The service worker owns provider branching, preview-generation behavior, archive extraction, and download orchestration, so regressions there belong to service-worker tests.
- Symbol library append behavior depends on `chrome.storage.local`, not on local filesystem reads.
- Library-mode download paths remain relative to Downloads and are resolved from popup settings, not absolute filesystem paths.
- Mouser / SamacSys support is intentionally Chrome-first. Firefox currently returns an explicit unsupported error until a proxy path exists.
- Mouser ZIP-export `401` responses are mapped to a sign-in-required error because upstream authentication can be stricter for downloads than for previews.
- The current repository is intentionally compact; do not impose extra architectural layers that are not already implemented.
- The manifest intentionally declares both `background.service_worker` and `background.scripts` so Chrome can run the service worker while Firefox falls back to a background document on Firefox 121+.
