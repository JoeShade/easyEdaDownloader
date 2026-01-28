# Contributing to easyEdaDownloader

Thanks for your interest in contributing to **easyEdaDownloader**.

This project is a Chrome extension that extracts an LCSC part number from **JLCPCB** or **LCSC** product pages and downloads related **EasyEDA** symbol data, footprint data, and 3D model files. Please keep the project’s scope and constraints in mind while contributing. :contentReference[oaicite:1]{index=1}

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Running and debugging](#running-and-debugging)
- [Change guidelines](#change-guidelines)
- [Commit and PR guidelines](#commit-and-pr-guidelines)
- [Security](#security)
- [License](#license)

## Code of conduct

Be respectful and constructive in issues, pull requests, and reviews. If you see problematic behavior, please open an issue.

## Ways to contribute

- **Bug reports**: broken downloads, parsing failures, site markup changes, wrong file naming/structure.
- **Compatibility fixes**: new/changed JLCPCB or LCSC page layouts; additional part page variants.
- **Features** (within scope): improved UX in the popup, more resilient fetch/retry logic, better file organisation options.
- **Documentation**: clearer setup steps, troubleshooting notes, known limitations, or examples.

## Before you start

### Check existing issues
If an issue already exists, add details there (page URL, part number, browser version, console output, screenshots).

### Repro details that help
For bugs, include:
- The **exact LCSC/JLCPCB URL**
- The **LCSC part number**
- Expected vs actual behavior
- Chrome version + OS
- Any errors from:
  - Extension service worker console
  - Content script console on the target page
  - Network errors

### Respect data correctness constraints
Per the project disclaimer: downloaded files may be incorrect; contributors should preserve or improve correctness, but avoid claiming guarantees. Validate changes with manual review of exported artifacts. :contentReference[oaicite:2]{index=2}

## Development setup

### Prerequisites
- Google Chrome (or Chromium-based browser that supports Chrome extensions)
- Git

### Clone
```bash
git clone https://github.com/JoeShade/easyEdaDownloader.git
cd easyEdaDownloader
