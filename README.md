# EasyEDA Downloader

EasyEDA Downloader is a browser extension that exports KiCad-compatible CAD assets from supported distributor product pages.

The extension currently supports:

- EasyEDA-backed JLCPCB and LCSC pages
- SamacSys-backed distributor pages for Mouser and Farnell

For EasyEDA-backed parts, the extension can export symbols, footprints, 3D models, and datasheets when the upstream payload exposes them. For SamacSys-backed parts, the extension downloads the upstream KiCad assets and repackages them into the same loose-file or KiCad-library structure used by the rest of the extension.

## Disclaimer

Generated library files may require manual review. Always verify symbols, footprints, 3D models, and datasheets before use in a real design.

## Install

### Chrome

Install from the Chrome Web Store:

[EasyEDA Downloader](https://chromewebstore.google.com/detail/easyeda-downloader/egbkokdcahpjimldjjaobimnofbdnncb)

### Firefox

Install from Firefox Add-ons:

[EasyEDA Downloader on AMO](https://addons.mozilla.org/en-GB/firefox/addon/easyeda-downloader/)

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

## Supported workflows

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

## Browser support

- EasyEDA-backed JLCPCB and LCSC export works in Chrome and Firefox.
- SamacSys distributor export works directly in Chrome.
- Firefox can use SamacSys distributor export only when an advanced user-managed relay URL is configured in the popup settings.
- SamacSys ZIP export may require the user to be signed in to the upstream service even when previews still load. On Firefox relay mode, the extension forwards matching SamacSys cookies through the relay, can generate the upstream SamacSys HTTP Basic auth header locally from optional stored credentials, can fall back to the latest captured upstream `Authorization` header, and can send separate relay auth to the Worker itself.

For a ready-to-deploy Cloudflare Worker relay example, see [docs/firefox-samacsys-proxy.md](docs/firefox-samacsys-proxy.md).

## Settings

The popup exposes persistent settings for download layout plus advanced Firefox SamacSys relay controls:

- `Download individually`: when enabled, downloads loose files directly into `Downloads`
- `Library folder in Downloads`: the Downloads-relative root used for KiCad library mode, such as `easyEDADownloader` or `KiCad/easyEDA`
- `Firefox SamacSys proxy URL`: an optional advanced relay URL used only for Mouser/Farnell SamacSys requests on Firefox
- `Firefox SamacSys proxy Authorization header`: an optional relay-auth header, such as `Bearer ...` or `Basic ...`, sent only to the configured Cloudflare Worker relay
- `SamacSys username` and `SamacSys password`: optional upstream credentials used to generate the SamacSys HTTP Basic auth header locally
- `Manual SamacSys Authorization override`: an optional upstream SamacSys `Authorization` header that overrides the auto-captured value when ZIP export still needs explicit HTTP Basic auth
- `Auto-captured SamacSys Authorization`: a read-only status showing whether Firefox has recently observed and stored an upstream `componentsearchengine.com` `Authorization` header for reuse in relay mode

For authenticated SamacSys ZIP downloads in Firefox, the extension uses this upstream auth precedence:

- `Manual SamacSys Authorization override`
- generated Basic auth from `SamacSys username` and `SamacSys password`
- latest captured upstream SamacSys `Authorization` header
- no upstream auth header

If you do not want to store credentials, stay signed in on the upstream Mouser/Farnell SamacSys flow so the extension can forward matching `componentsearchengine.com` cookies through the relay and capture the latest upstream `Authorization` header when the browser sends one. If export still returns the sign-in-required error, the extension will do one automatic refresh-and-retry cycle after a `401` ZIP response. If your Worker itself is protected, put its credential in `Firefox SamacSys proxy Authorization header`.

When `Download individually` is disabled, the extension writes a KiCad-style library layout under:

`Downloads/<library root>/`

Library mode uses the final folder segment as the library name:

- `<library name>.kicad_sym`
- `<library name>.pretty/`
- `<library name>.3dshapes/`

## Development

Use Node `22.13.0+` (recommended), Node `20.19.0+`, or Node `24+`. Node `21.x` is not supported by the current Vitest/Vite/jsdom stack.

Install dependencies and run the regression suite:

```bash
npm install
npm test
```

The repository includes `.nvmrc` for the recommended Node version.

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

`systemDesign.md` is the design source of truth. `docs/architecture-notes.md` captures short implementation notes that supplement it.

## Contributing

Read [contributing.md](contributing.md) for contribution expectations and [AGENTS.md](AGENTS.md) for repository working rules.

## License and attribution

This project includes and is derived from:

`easyeda2kicad.py`  
Copyright (c) uPesy  
Licensed under the GNU Affero General Public License v3.0

Additional code in this repository remains under the repository license.
