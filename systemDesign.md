# System Design: EasyEDA Downloader

## 1. Purpose

This document describes the current implemented design of the EasyEDA Downloader browser extension.

The extension is intentionally narrow:

- detect an LCSC part id from supported product pages
- detect a manufacturer part number from supported page metadata when present
- fetch EasyEDA-backed CAD data for that part
- generate KiCad-compatible symbol, footprint, and 3D outputs
- optionally download a datasheet when the upstream payload exposes one
- save outputs either as loose files or under a KiCad-style library directory

This document should describe what the repository actually does today. If code and design diverge, update one of them in the same change.

## 2. Scope and non-goals

### 2.1 Implemented workflow

The current extension supports this operator flow:

1. Open a supported JLCPCB or LCSC product page.
2. Open the extension popup.
3. Ask the content script to detect the LCSC part id and manufacturer part number from the current page.
4. Ask the service worker for symbol and footprint previews plus datasheet availability metadata.
5. Choose which artifacts to export and whether to download them individually.
6. Ask the service worker to fetch EasyEDA CAD data, convert it, and trigger downloads.

### 2.2 Explicit non-goals

The current repository does not implement:

- browser automation outside the popup/content-script/service-worker model
- a fake multi-layer application architecture beyond the existing file split
- end-to-end browser-run integration tests inside real Chrome or Firefox
- production refactors for testability
- custom network backends beyond the currently hard-coded EasyEDA and module endpoints

## 3. Supported contexts and assumptions

- The content script is injected only on matching JLCPCB and LCSC pages.
- The extension assumes the page exposes an LCSC-style part id such as `C12345` somewhere in a definition list, product table, or the broader page text.
- The extension reads the manufacturer part number only from targeted page metadata labeled `Mfr. Part #`.
- The popup assumes it is opened against an active tab and that the content script can answer `GET_LCSC_ID` on supported pages.
- EasyEDA API responses are treated as the authoritative CAD payload source.
- 3D model downloads depend on footprint metadata exposing a model UUID.
- Datasheet download availability depends on URLs present in the EasyEDA payload.
- The configurable library download root must remain a path relative to the browser's Downloads directory, not an absolute filesystem path.
- The Manifest V3 background is declared for both Chrome and Firefox: Chrome uses `background.service_worker`, while Firefox uses the background-document fallback from `background.scripts`. This combined manifest relies on Firefox 121 or newer.

## 4. Repository architecture

The runtime is intentionally direct and file-oriented.

### 4.1 `src/content_script.js`

Owns page inspection only:

- label normalization
- LCSC id extraction from text
- manufacturer part number extraction from targeted labels
- definition-list scanning
- table scanning
- full-page text fallback
- reply to popup-originated `GET_LCSC_ID` requests

It should remain a small DOM-reading boundary with no network or download logic.

### 4.2 `src/popup.js`

Owns popup UI state and user interaction:

- cache popup DOM elements
- load and save popup settings through `chrome.storage.local`
- query the active tab and request the current LCSC id plus manufacturer part number
- request previews and datasheet availability
- keep the Download button enabled only when a part id and at least one selected artifact exist
- show the manufacturer part number above the LCSC id in the popup
- collect and validate the library-mode Downloads subfolder setting
- display normal, warning, and error status text
- send `EXPORT_PART` requests to the service worker

It should remain the UI-facing boundary. It should not own EasyEDA fetches, conversion logic, or download orchestration.

### 4.3 `src/service_worker.js`

Owns orchestration and browser-integrated work:

- settings load for download behavior
- library-mode download root resolution
- EasyEDA CAD payload fetches
- preview SVG generation from CAD payload data
- datasheet URL normalization and filename derivation
- symbol-library merge behavior backed by `chrome.storage.local`
- STEP and OBJ fetches for 3D model export
- OBJ-to-WRL conversion via the converter module
- download triggering through `chrome.downloads`
- warning accumulation and response shaping for popup requests

This file is the operational core of the extension.

### 4.4 `src/kicad_converter.js`

Owns conversion rules that are largely testable without browser APIs:

- EasyEDA symbol parsing
- EasyEDA footprint parsing
- coordinate, unit, and text-style conversion
- KiCad symbol text generation
- KiCad footprint text generation
- OBJ/MTL-style parsing and WRL emission

It should remain the main pure conversion boundary.

### 4.5 `tests`

The test suite is the primary regression net for:

- pure conversion behavior
- page-detection logic
- popup state transitions and messaging
- service-worker orchestration and download behavior
- repository governance and footer discipline

## 5. Core data flow

### 5.1 Detect popup identifiers

- The popup queries the active tab.
- The popup asks the content script for `GET_LCSC_ID`.
- The content script checks definition lists first, then the known table layout, then falls back to a page-wide scan for the LCSC id only.
- The manufacturer part number is read only from targeted definition-list and table metadata labeled `Mfr. Part #`.
- The popup stores the detected values, renders the manufacturer part number above the LCSC id, and uses only the LCSC id to gate export actions.

### 5.2 Request previews

- Once a part id is available, the popup asks the service worker for `GET_PREVIEW_SVGS`.
- The service worker fetches the EasyEDA CAD payload.
- The service worker derives lightweight SVG previews from the symbol and footprint portions of the payload.
- The popup renders those previews and updates datasheet availability state.

### 5.3 Fetch EasyEDA CAD payload

- The service worker fetches the EasyEDA component payload using the detected LCSC id.
- Missing or invalid payloads are treated as errors.
- The fetched payload is reused for preview generation, datasheet inspection, and export orchestration.

### 5.4 Generate KiCad outputs

- The service worker asks `src/kicad_converter.js` to convert symbol and footprint data when those exports are requested.
- The converter parses EasyEDA payload strings, normalizes geometry/text, and emits KiCad-compatible text files.
- When a footprint exposes 3D model metadata, the service worker fetches STEP and OBJ assets and converts OBJ to WRL.

### 5.5 Handle datasheet URL

- The service worker derives datasheet availability from payload URLs in package, symbol, or LCSC metadata.
- URL normalization handles protocol-relative URLs.
- Datasheet filenames are derived from package/title metadata and preserve the upstream file extension when one can be determined.
- Missing datasheets do not fail the whole export; they surface as warnings.

### 5.6 Download behavior

- If `downloadIndividually` is `true`, artifacts are downloaded as loose files.
- Otherwise, downloads use a KiCad-style directory structure rooted at a user-configurable folder under Downloads.
- The default library-mode root is `easyEDADownloader/`.
- Symbol downloads in library mode merge into `<libraryRoot>/<libraryName>.kicad_sym`.
- Footprints download into `<libraryRoot>/<libraryName>.pretty/`.
- 3D assets download into `<libraryRoot>/<libraryName>.3dshapes/`.
- Datasheets download either as loose files or under `<libraryRoot>/`.

## 6. Storage and settings behavior

- `chrome.storage.local` stores popup settings, currently `downloadIndividually` plus the library-mode Downloads root.
- `chrome.storage.local` also stores the accumulated symbol library content used for append-style symbol exports in library mode.
- Popup settings are convenience state for UI behavior.
- Stored symbol library content is keyed by the resolved library root so separate library folders keep separate merged symbol libraries.

## 7. Preview generation behavior

- Preview generation happens in the service worker, not in the popup.
- Symbol previews are synthesized from EasyEDA symbol primitives.
- Footprint previews are synthesized from footprint pads and selected graphics primitives.
- Preview generation is best-effort. Missing previewable data produces unavailable-state UI rather than blocking the popup entirely.

## 8. Error and warning handling

- Detection failures in the popup produce user-facing status messages and disable export.
- Service-worker preview failures return structured error responses to the popup.
- Export failures return structured error responses to the popup.
- Partial export issues that do not invalidate the whole request, such as missing datasheets, are accumulated as warnings.
- The popup distinguishes default, warning, and error status tones.

## 9. External dependencies and browser APIs

### 9.1 Network dependencies

- EasyEDA component API for CAD payloads
- EasyEDA module endpoints for STEP and OBJ assets

### 9.2 Browser APIs

- `chrome.tabs`
- `chrome.runtime`
- `chrome.storage.local`
- `chrome.downloads`
- `Blob` and `URL.createObjectURL` when available for download-safe object URLs

## 10. Output artifacts and naming rules

- Symbol output uses KiCad symbol library text and either a standalone `<lcscId>-<symbolName>.kicad_sym` file or the shared library file.
- Footprint output uses `<footprintName>.kicad_mod`.
- 3D outputs use sanitized model names for downloaded STEP and WRL files.
- Datasheet output uses a sanitized base name plus `-datasheet` and the detected file extension.
- The library root name defaults to `easyEDADownloader` and can be changed to another Downloads-relative folder for library mode.

## 11. Maintainability and testing boundaries

- `src/kicad_converter.js` should stay the main unit-test target for pure conversion rules.
- `src/content_script.js` should stay small enough to test through DOM fixtures and message mocks.
- `src/popup.js` should be tested with DOM fixtures and mocked browser APIs rather than real extension runs.
- `src/service_worker.js` should be tested with mocked browser APIs, mocked fetch, and controlled converter stubs.
- The current Vitest/Vite/jsdom test stack requires Node `20.19.0+`, `22.13.0+`, or `24+`.
- Production source should not be refactored solely to make tests easier; harnesses should adapt to the existing code shape.

## 12. Repository rules that should remain true

- Do not change extension runtime behavior casually.
- Do not reorganize production files without a real architectural reason.
- Keep browser API orchestration in the service worker, UI state in the popup, DOM extraction in the content script, and conversion rules in the converter.
- Keep governance files and hygiene tests aligned with the codebase.
