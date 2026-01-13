# Easy EDA Downloader Chrome Extension

This README explains what the extension does, how to load it in Chrome, and
how to use the popup to export EasyEDA symbols, footprints, and 3D models.

This extension grabs an LCSC part number from JLCPCB or LCSC product pages and
downloads the EasyEDA symbol data, footprint data, and 3D model files directly
without calling any external programs.

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
