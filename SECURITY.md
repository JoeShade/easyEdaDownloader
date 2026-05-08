# Security Policy

## Supported Versions

Security fixes are made against the active development branch and the current browser-store release where practical. Older unpacked development builds are not separately maintained.

## Reporting a Vulnerability

Please do not open a public issue for credential leaks, auth bypasses, extension permission problems, or relay-forwarding vulnerabilities.

Use the repository's private vulnerability reporting or GitHub Security Advisory flow when available. If that is not available, contact the maintainer through the repository, Chrome Web Store listing, or Firefox Add-ons listing with:

- the affected browser and version
- the product page or provider flow involved
- clear reproduction steps
- the impact you believe is possible
- whether credentials, cookies, downloads, or relay requests are involved

Do not include live credentials, private cookies, browser-profile exports, or private KiCad libraries in reports, tests, fixtures, screenshots, or public discussion.

## Credential and Auth Handling

The extension stores user settings in `chrome.storage.local`. That storage can include:

- the optional Firefox SamacSys relay URL
- the optional Firefox SamacSys relay `Authorization` header
- optional SamacSys username and password values used to generate upstream HTTP Basic auth
- an optional manual upstream SamacSys `Authorization` override
- the latest Firefox-captured upstream SamacSys `Authorization` header and capture timestamp
- accumulated KiCad symbol-library text used for library-mode exports

Relay auth and upstream SamacSys auth are intentionally separate. The relay auth header is sent only to the configured user-managed relay. Upstream SamacSys auth is sent only to SamacSys or inside a relay payload that asks the relay to contact SamacSys.

The repository does not host or operate a relay service. Users who configure a relay are responsible for its deployment, access controls, logs, and secret handling.

To clear stored credentials, blank the corresponding popup settings and save them, or remove the extension's local storage from the browser. Removing the extension also clears its extension-owned local storage in normal browser configurations.

## Security-Sensitive Areas

Please report issues involving:

- over-broad extension permissions or unexpected host access
- credential exposure in popup UI, logs, downloads, tests, fixtures, or docs
- incorrect separation between relay auth and upstream SamacSys auth
- unsafe forwarding of cookies or authorization headers
- HTML or URL parsing that could cause incorrect provider detection
- download path construction that could escape the intended Downloads-relative layout
- dependency or supply-chain vulnerabilities
