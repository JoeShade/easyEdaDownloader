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

The repository hygiene suite checks for high-confidence token/private-key patterns, placeholder-only credential fixtures, encoded HTTP Basic auth examples, and common temporary, archive, log, and local-environment files. A separate history-wide security check applies those rules across reachable Git history during full validation and CI. Treat these as backstops, not as a substitute for reviewing changes before commit; the history-wide check does not need to be run manually for every intermediate local commit.

## Credential and Auth Handling

The extension stores ordinary settings in `chrome.storage.local`. That storage can include:

- the optional Firefox SamacSys relay URL
- remember-on-this-device flags for optional secrets
- accumulated KiCad symbol-library text used for library-mode exports

The optional Firefox authentication token and optional SamacSys username/password are stored in `chrome.storage.session` by default, so they are kept only for the current browser session. They are copied to `chrome.storage.local` only when the user explicitly ticks the matching `Remember ... on this device` box after reading the warning in the settings page.

Relay auth and upstream SamacSys auth are intentionally separate. The relay auth header is sent only to the configured user-managed relay. Upstream SamacSys auth is sent only to SamacSys or inside a relay payload that asks the relay to contact SamacSys.

The repository does not host or operate a relay service. Users who configure a relay are responsible for its deployment, access controls, logs, and secret handling.

To clear stored credentials, use the clear buttons in the settings page, untick remember-on-this-device options, or remove the extension's local/session storage from the browser. Removing the extension also clears its extension-owned storage in normal browser configurations.

## Security-Sensitive Areas

Please report issues involving:

- over-broad extension permissions or unexpected host access
- credential exposure in popup UI, logs, downloads, tests, fixtures, or docs
- incorrect separation between relay auth and upstream SamacSys auth
- unsafe forwarding of cookies or authorization headers
- HTML or URL parsing that could cause incorrect provider detection
- download path construction that could escape the intended Downloads-relative layout
- dependency or supply-chain vulnerabilities
