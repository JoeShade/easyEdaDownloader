# Architecture Notes

This file records short implementation notes that supplement, but do not replace, [systemDesign.md](../systemDesign.md).

## Layer boundaries

- `src/content_script.js`: DOM inspection and LCSC id extraction only
- `src/popup.js`: popup UI state, settings, preview requests, and export requests
- `src/service_worker.js`: network fetches, preview generation, symbol-library merging, and downloads
- `src/kicad_converter.js`: EasyEDA parsing, KiCad text generation, and OBJ-to-WRL conversion

## Testability notes

- `src/kicad_converter.js` is the main pure logic boundary and should stay the easiest module to unit test directly.
- `src/content_script.js` should stay small and DOM-driven so it can be exercised with markup fixtures.
- `src/popup.js` should keep browser messaging and DOM updates visible enough to test with mocked `chrome.*` APIs.
- `src/service_worker.js` should keep browser-dependent orchestration there, with tests using mocks instead of browser-run end-to-end flows.

## Current implementation caveats worth preserving

- The popup does not fetch or convert CAD data directly; it only requests that work.
- The service worker owns preview-generation behavior, so preview regressions belong to service-worker tests.
- Symbol library append behavior depends on `chrome.storage.local`, not on local filesystem reads.
- The current repository is intentionally compact; do not impose extra architectural layers that are not already implemented.
