# Easy EDA Downloader Chrome Extension

This README explains what the extension does, how to load it in Chrome, and
how to use the popup to export EasyEDA symbols, footprints, and 3D models.

This extension grabs an LCSC part number from JLCPCB or LCSC product pages and
downloads the EasyEDA symbol data, footprint data, and 3D model files directly
without calling any external programs.

## Upstream project

This project is derived from and based on algorithms and concepts from
easyeda2kicad.py by uPesy
https://github.com/uPesy/easyeda2kicad.py

Licensed under GNU AGPL-3.0


## Setup

1. Load the extension in Chrome:
   - Visit `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select `easyEdaDownloader/`.

## Usage

1. Open a JLCPCB or LCSC product page.
2. Click the extension action button.
3. The extension will download the symbol JSON, footprint JSON, and 3D model files
   to your default downloads folder.

## Settings

The popup includes a **Download individually** option.

- Disabled (default): files are saved under `Downloads/easyEDADownloader/` using
  KiCad library structure (`easyEDADownloader.kicad_sym`, `.pretty/`, `.3dshapes/`).
- Enabled: files are downloaded as loose files directly into Downloads.

This project includes and is derived from:

easyeda2kicad.py
Copyright (c) uPesy
Licensed under the GNU Affero General Public License v3.0

Modifications and additional code:
Copyright (c) JoeShade
Licensed under the GNU Affero General Public License v3.0
