# Contributing to easyEdaDownloader

Thanks for contributing.

This repository is a compact browser extension that exports KiCad-compatible CAD assets from supported EasyEDA-backed and SamacSys-backed product pages. Keep the current scope, runtime split, and repository rules in mind when making changes.

Read `AGENTS.md` before changing code, tests, or governance docs.

## Ways to contribute

- Bug reports for broken detection, preview failures, wrong file naming, or bad export behavior
- Compatibility fixes for changed site markup on supported providers
- Focused feature work that fits the current popup, content-script, and service-worker model
- Documentation improvements for setup, troubleshooting, and supported behavior

## Useful bug report details

Include:

- the exact product page URL
- the detected part number or expected part number
- expected behavior versus actual behavior
- browser and OS version
- any relevant popup, content-script, or service-worker errors

For SamacSys-backed pages, note whether previews worked, whether ZIP export failed, and whether the upstream site required sign-in.

## Development setup

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Load the extension unpacked in Chrome or temporarily in Firefox.
4. Run `npm test` before finalizing changes.

Use `README.md` for the operator-facing overview. Use `systemDesign.md` for the implemented design and `docs/architecture-notes.md` for short implementation notes.

## Change guidelines

- Make small, explicit changes.
- Update tests with every substantive behavior change.
- Update docs when behavior, support boundaries, or module ownership changes.
- Do not refactor production files unless behavior or repository rules require it.
- Keep browser API orchestration in the worker, DOM extraction in the content script, and UI state in the popup.

## Pull requests

- Run `npm test` before opening or updating a pull request.
- Summarize the user-visible or repository-level impact clearly.
- Call out manual verification, assumptions, and remaining risks.

## Security

Do not commit secrets, browser-profile data, or private keys. Report security-sensitive issues privately when appropriate.

## License

By contributing, you agree that your contributions will be distributed under the repository license.
