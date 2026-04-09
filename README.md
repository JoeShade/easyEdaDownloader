# EasyEDA Downloader – Export Symbols, Footprints & 3D Models to KiCad

[![GitHub stars](https://img.shields.io/github/stars/JoeShade/easyEdaDownloader.svg?style=flat-square)](https://github.com/JoeShade/easyEdaDownloader/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/JoeShade/easyEdaDownloader.svg?style=flat-square)](https://github.com/JoeShade/easyEdaDownloader/network/members)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/egbkokdcahpjimldjjaobimnofbdnncb?style=flat-square)](https://chromewebstore.google.com/detail/easyeda-downloader/egbkokdcahpjimldjjaobimnofbdnncb)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/egbkokdcahpjimldjjaobimnofbdnncb?style=flat-square)](https://chromewebstore.google.com/detail/easyeda-downloader/egbkokdcahpjimldjjaobimnofbdnncb)
[![Firefox Add-ons](https://img.shields.io/amo/v/easyeda-downloader?style=flat-square)](https://addons.mozilla.org/en-GB/firefox/addon/easyeda-downloader/)
[![Firefox Add-on Users](https://img.shields.io/amo/users/easyeda-downloader?style=flat-square)](https://addons.mozilla.org/en-GB/firefox/addon/easyeda-downloader/)

EasyEDA Downloader is a Chrome and Firefox extension that lets you export electronic components from supported EasyEDA-backed JLCPCB/LCSC pages and Mouser SamacSys ECAD pages as **KiCad-compatible symbols, footprints, and 3D models**, with optional datasheet downloads for EasyEDA-backed parts.

It streamlines PCB design workflows by eliminating manual library creation when sourcing components from JLCPCB, LCSC, and supported Mouser listings.

## Disclaimer

Generated library files may require manual review. Always double-check symbols, footprints, 3D models, and datasheets before use.

## Setup

### Install from Chrome Web Store

https://chromewebstore.google.com/detail/easyeda-downloader/egbkokdcahpjimldjjaobimnofbdnncb

### Install from Firefox Addons Store

https://addons.mozilla.org/en-GB/firefox/addon/easyeda-downloader/

### Manual Install for development builds

1. Load the extension in Chrome:
   - Visit `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select `easyEdaDownloader/`.
2. Load the extension in Firefox:
   - Visit `about:debugging#/runtime/this-firefox`.
   - Click **Load Temporary Add-on**.
   - Select `manifest.json` from `easyEdaDownloader/`.
   - This development manifest expects Firefox 121 or newer so Firefox can use the background-document fallback while Chrome uses the Manifest V3 service worker.
   - The repo uses a dev-only Gecko add-on ID so temporary installs do not collide with the AMO-installed release build.

## Features

- Download components directly from EasyEDA-backed JLCPCB and LCSC pages
- Download pre-generated KiCad assets from supported Mouser SamacSys ECAD pages
- Export **KiCad symbols**
- Export **KiCad footprints**
- Export **3D models**
- Download accompanying datasheets when available for EasyEDA-backed parts
- Reduce manual work when building KiCad libraries
- Works in Chrome and Firefox, with Mouser export currently Chrome-only

## Use Cases

- KiCad users sourcing components from JLCPCB or LCSC
- KiCad users sourcing components from Mouser pages that expose the SamacSys ECAD button
- PCB designers building custom component libraries
- Electronics hobbyists and professionals using EasyEDA
- Open-source hardware projects

## How to use

1. Open a supported JLCPCB, LCSC, or Mouser product page.
2. Click the extension action button.
3. The popup shows the detected manufacturer part number plus the provider-specific source part number (`LCSC part` or `Mouser part`).
4. On EasyEDA-backed pages, the extension fetches CAD data, renders previews, and exports the selected symbol, footprint, 3D model, and optional datasheet files.
5. On supported Mouser pages, the extension uses the SamacSys / Component Search Engine assets behind the ECAD button, renders symbol and footprint previews, and exports the selected KiCad symbol, footprint, and 3D files.

## Browser support notes

- EasyEDA-backed JLCPCB and LCSC export works in Chrome and Firefox.
- Mouser / SamacSys export currently works in Chrome only.
- Firefox still needs a proxy or alternate backend for the required Mouser / SamacSys cross-origin requests, which is intentionally out of scope in this repository.
- Mouser / SamacSys ZIP export may require the user to be signed in before the upstream service will authorize the CAD download, even when previews still load.

## Settings

The popup includes:

- **Download individually**:
  Disabled keeps the KiCad-style library structure.
  Enabled downloads loose files directly into Downloads.
- **Library folder in Downloads**:
  Sets the library-mode root folder relative to Downloads, such as `easyEDADownloader` or `KiCad/easyEDA`.
  This setting applies only when **Download individually** is disabled.
  Mouser SamacSys exports are extracted from the upstream ZIP and repackaged into this KiCad library structure when library mode is enabled.

In library mode, files are saved under `Downloads/<your folder>/` using KiCad library structure named after the final folder segment (`<folder name>.kicad_sym`, `.pretty/`, `.3dshapes/`).

## Testing

Use Node `22.13.0+` (recommended), Node `20.19.0+`, or Node `24+` before installing dev dependencies and running the regression suite. Node `21.x` is not supported by the current Vitest/Vite/jsdom toolchain.

The repository includes `.nvmrc` for the recommended Node version.

Install the dev dependencies and run the regression suite:

```bash
npm install
npm test
```

Repository design and governance live in `systemDesign.md`, `AGENTS.md`,
`docs/architecture-notes.md`, and `docs/deviations.md`.

## Contributing

Pull requests and issues are welcome.  
If you find a bug or want to improve support for additional components, feel free to open an issue.
Before contributing, read `AGENTS.md` for repository working rules and
`contributing.md` for the project’s contribution instructions.

This project includes and is derived from:

easyeda2kicad.py  
Copyright (c) uPesy  
Licensed under the GNU Affero General Public License v3.0

Modifications and additional code:  
Copyright (c) JoeShade  
Licensed under the GNU Affero General Public License v3.0
