# EasyEDA Downloader – Export Symbols, Footprints & 3D Models to KiCad
![GitHub stars](https://img.shields.io/github/stars/JoeShade/easyEdaDownloader)
![GitHub forks](https://img.shields.io/github/forks/JoeShade/easyEdaDownloader)
![Chrome Web Store](https://img.shields.io/chrome-web-store/v/egbkokdcahpjimldjjaobimnofbdnncb)


EasyEDA Downloader is a Chrome extension that lets you download electronic components directly from EasyEDA, JLCPCB, and LCSC product pages and export them as **KiCad-compatible symbols, footprints, and 3D models**.

It streamlines PCB design workflows by eliminating manual library creation when sourcing components from JLCPCB or LCSC.

## Setup

### Install from Chrome Web Store

https://chromewebstore.google.com/detail/easyeda-downloader/egbkokdcahpjimldjjaobimnofbdnncb

### Manual Install

1. Load the extension in Chrome:
   - Visit `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select `easyEdaDownloader/`.

## Features

- Download components directly from EasyEDA, JLCPCB, and LCSC pages
- Export **KiCad symbols**
- Export **KiCad footprints**
- Export **3D models**
- Reduce manual work when building KiCad libraries
- Works as a lightweight Chrome extension

## Use Cases

- KiCad users sourcing components from JLCPCB or LCSC
- PCB designers building custom component libraries
- Electronics hobbyists and professionals using EasyEDA
- Open-source hardware projects

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

## Contributing

Pull requests and issues are welcome.  
If you find a bug or want to improve support for additional components, feel free to open an issue.

