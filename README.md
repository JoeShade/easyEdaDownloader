# Easy ECAD Downloader

## Introduction

Easy ECAD Downloader is a browser extension that exports KiCad-compatible CAD assets from supported distributor product pages.

The extension currently supports:

- EasyEDA-backed JLCPCB and LCSC pages
- SamacSys-backed distributor pages for Mouser and Farnell

For EasyEDA-backed parts, the extension can export symbols, footprints, 3D models, and datasheets when the upstream payload exposes them. For SamacSys-backed parts, the extension downloads the upstream KiCad assets and repackages them into the same loose-file or KiCad-library structure used by the rest of the extension.

## Disclaimer

Generated library files may require manual review. Always verify symbols, footprints, 3D models, and datasheets before use in a real design.

## Set-up

### Chrome

Install from the Chrome Web Store:

[Easy ECAD Downloader](https://chromewebstore.google.com/detail/easy-ecad-downloader/egbkokdcahpjimldjjaobimnofbdnncb)

### Firefox

Install from Firefox Add-ons:

[Easy ECAD Downloader on AMO](https://addons.mozilla.org/en-GB/firefox/addon/easy-ecad-downloader/)

### Manual install for development

Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the repository root that contains `manifest.json`.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json` from the repository root.

The development manifest expects Firefox `121+` so Firefox can use the background-document fallback while Chrome uses the Manifest V3 service worker.

### Development

Use Node `22.13.0+` (recommended), Node `20.19.0+`, or Node `24+`. Node `21.x` is not supported by the current Vitest/Vite/jsdom stack.

Install dependencies and run the local checks:

```bash
npm install
npm run lint
npm test
npm run validate
```

`npm run validate` runs linting, the Vitest regression suite, a moderate-severity dependency audit, and whitespace checks. CI uses `npm ci` and the same validation script on the supported Node lines. The repository includes `.nvmrc` for the recommended Node version.

The Vitest suite includes a history-wide security hygiene check. It is meant for full validation, CI, security cleanup, and before sharing pushed history; it does not need to be run manually for every intermediate local commit while iterating.

## Usage

### EasyEDA-backed JLCPCB and LCSC pages

- Detect the LCSC part id from the product page
- Fetch the EasyEDA CAD payload
- Render symbol and footprint previews in the popup
- Export KiCad symbols, footprints, 3D models, and optional datasheets

### SamacSys-backed Mouser and Farnell pages

- Detect the distributor part metadata and upstream SamacSys entry point
- Fetch symbol and footprint previews from the upstream preview endpoints
- Download the upstream KiCad ZIP
- Export the selected symbol, footprint, and 3D assets

### Browser support

- EasyEDA-backed JLCPCB and LCSC export works in Chrome and Firefox.
- SamacSys distributor export works directly in Chrome.
- Firefox can use SamacSys distributor export only when an advanced user-managed relay URL is configured in the extension settings page.
- SamacSys ZIP export may require the user to be signed in to the upstream service even when previews still load. Chrome first tries the normal browser session and then retries one ZIP download with configured upstream auth if the first ZIP request returns `401`. On Firefox relay mode, the extension forwards matching SamacSys cookies through the relay, can generate the upstream SamacSys HTTP Basic auth header locally from optional session or remembered credentials, can fall back to a fresh captured upstream `Authorization` header, and can send separate helper-service auth to the Worker itself.

### Settings

Use the popup `Open settings` button, or the browser extension settings page, to choose where files are saved and add sign-in details only when Mouser/Farnell downloads require them:

- `Save each file separately`: downloads separate files directly into `Downloads`
- `KiCad library folder`: stores grouped KiCad library exports in a Downloads folder, such as `easyECADDownloader` or `KiCad/easyECAD`
- `SamacSys username` and `SamacSys password`: optional sign-in details for Mouser/Farnell CAD downloads

Firefox shows an `Advanced Firefox settings` menu for the helper service URL, optional helper password/token, and recent Firefox sign-in status. Chrome hides that menu.

Password and token fields are blank when the settings page opens. New values are kept for the current browser session by default. Tick the relevant `Remember ... on this device` box only if you accept the risk of storing that secret in the browser profile.

Settings changes are not stored until you press `Save`. Use `Discard` to restore the last loaded settings.

For authenticated SamacSys ZIP downloads, the extension uses this upstream auth precedence:

- generated Basic auth from `SamacSys username` and `SamacSys password`
- latest captured upstream SamacSys `Authorization` header
- no upstream auth header

If you do not want to remember credentials on this device, leave the remember boxes unticked and stay signed in on the upstream Mouser/Farnell SamacSys flow so the extension can reuse the browser session directly on Chrome or through the helper service on Firefox.

When `Download individually` is disabled, the extension writes a KiCad-style library layout under:

`Downloads/<library root>/`

Library mode uses the final folder segment as the library name:

- `<library name>.kicad_sym`
- `<library name>.pretty/`
- `<library name>.3dshapes/`

## Contributing

Read [contributing.md](contributing.md) for contribution expectations and [AGENTS.md](AGENTS.md) for repository working rules.

## Supporting docs

- [systemDesign.md](systemDesign.md): design source of truth
- [CHANGELOG.md](CHANGELOG.md): notable changes by release or branch delta
- [SECURITY.md](SECURITY.md): vulnerability reporting and credential-handling notes
- [docs/architecture-notes.md](docs/architecture-notes.md): short implementation notes
- [docs/firefox-samacsys-proxy.md](docs/firefox-samacsys-proxy.md): Cloudflare Worker relay example for Firefox SamacSys support

## Repository layout

- `src/content_script.js`: DOM inspection and provider-aware part detection
- `src/popup.js`: popup UI, settings, preview requests, and export requests
- `src/service_worker.js`: thin runtime entrypoint
- `src/service_worker_runtime.js`: provider routing and worker orchestration
- `src/core/`: shared worker logic for settings, downloads, storage-backed symbol libraries, previews, and export artifact writing
- `src/sources/`: source adapters and provider-specific fetch or archive helpers
- `src/kicad_converter.js`: stable converter facade
- `src/kicad/`: EasyEDA parsing, KiCad emitters, shared conversion helpers, and OBJ-to-WRL conversion
- `tests/`: regression suite

## License and attribution

This project includes and is derived from:

`easyeda2kicad.py`  
Copyright (c) uPesy  
Licensed under the GNU Affero General Public License v3.0

Additional code in this repository remains under the repository license.
