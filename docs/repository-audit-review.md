# Professionalization Plan

This is a working review plan for turning the current branch into a more professional, user-trustworthy project. It is intentionally framed as a decision checklist, not as design authority. Keep `systemDesign.md` as the source of truth once decisions are made.

Validation status at the time this plan was drafted:

- `npm run validate` passed
- lint clean
- 87 tests passed
- dependency audit found 0 vulnerabilities

## Goals

1. Audit features added by third parties and decide what to keep, change, document, or remove.
2. Rebrand the project so the name, scope, README, manifest, and user-facing language match the current feature set.
3. Rewrite the README so it is clearer for non-technical users and easier to discover through search.
4. Tighten security around browser permissions, relay behavior, stored credentials, and release checks.

## Phase 1: Feature Audit

### Step 1: Build a Feature Inventory

Create a table of every user-visible and security-sensitive feature currently in the branch.

Suggested columns:

| Feature | Source area | User value | Supported browsers | Security risk | Maintenance cost | Keep/change/remove decision |
| --- | --- | --- | --- | --- | --- | --- |
| EasyEDA-backed LCSC/JLCPCB export | content script, service worker, KiCad converter | Core workflow | Chrome, Firefox | Low/medium | Core | Keep |
| SamacSys Mouser export | source adapter, service worker, popup auth settings | Expands distributor support | Chrome, Firefox with relay | Medium/high | Medium | Decide |
| SamacSys Farnell export | source adapter, service worker, popup auth settings | Expands distributor support | Chrome, Firefox with relay | Medium/high | Medium | Decide |
| Firefox SamacSys relay | settings, docs, Worker example | Enables Firefox support | Firefox | High | Medium/high | Decide |
| Stored SamacSys auth settings | popup, settings, storage | Helps authenticated ZIP downloads | Chrome, Firefox | High | Medium | Change |
| KiCad library folder mode | downloads, storage library assembly | User convenience | Chrome, Firefox | Low | Core | Keep |
| Loose-file download mode | downloads | User convenience | Chrome, Firefox | Low | Core | Keep |
| Preview generation | popup, service worker, converter | User confidence before export | Chrome, Firefox | Low | Core | Keep |

### Step 2: Trace Each Third-Party Feature

For each third-party-added feature, answer:

- What user problem does it solve?
- Is the feature documented in `README.md` and `systemDesign.md`?
- Is the behavior covered by tests?
- Does it require new permissions, credentials, cookies, relays, or network domains?
- Does it create an ongoing support burden?
- Would a non-technical user understand when and why they should use it?

### Step 3: Make Explicit Keep/Change/Remove Decisions

Use these decision rules:

- **Keep** when the feature is tested, documented, secure enough, and aligned with the intended scope.
- **Change** when the feature is valuable but needs permission narrowing, clearer UX, better tests, or safer defaults.
- **Remove** when the feature is hard to explain, hard to secure, fragile, or outside the product scope.
- **Defer** when the feature may be useful later but should not shape the next release.

Expected likely outcomes:

- Keep EasyEDA-backed export as the foundation.
- Keep SamacSys support only if the project is intentionally becoming a broader distributor-to-KiCad tool.
- Change Firefox relay support so it is clearly advanced, HTTPS-first, and documented as optional.
- Change stored-auth handling with stronger user controls and clearer warnings.

## Phase 2: Rebrand the Project

### Step 4: Define the New Scope in One Sentence

Before changing names, write the new scope plainly.

Possible scope statement:

> A browser extension that exports KiCad-compatible symbols, footprints, 3D models, and datasheets from supported electronics distributor pages.

This is broader than "EasyEDA Downloader", which now undersells the SamacSys and distributor-focused parts of the project.

### Step 5: Choose a Name That Matches the Scope

Good naming criteria:

- Clear to electronics users.
- Not tied to only one upstream source unless that is the intended long-term scope.
- Searchable for terms like `KiCad`, `LCSC`, `JLCPCB`, `Mouser`, `Farnell`, `CAD`, `footprint`, and `symbol`.
- Avoids implying official affiliation with EasyEDA, KiCad, Mouser, Farnell, JLCPCB, or LCSC.

Candidate naming directions:

- `KiCad Part Exporter`
- `Distributor CAD Exporter`
- `KiCad CAD Downloader`
- `Parts to KiCad`
- `EDA Part Exporter`

Decision needed:

- Keep the existing name if EasyEDA remains the primary brand promise.
- Rename if SamacSys and distributor support are first-class features.

### Step 6: Apply the Rebrand Consistently

Once a name is chosen, update:

- `README.md` title and introduction
- `manifest.json` extension name and description
- popup title and user-facing labels if applicable
- Chrome Web Store and Firefox AMO descriptions outside the repo
- `CHANGELOG.md`
- `systemDesign.md`
- security and support docs
- package metadata if the package name is user-visible

## Phase 3: README Rewrite

### Step 7: Restructure for Non-Technical Users

Proposed README order:

1. Project name and one-sentence value proposition.
2. Short disclaimer that generated CAD assets must be reviewed before use.
3. Supported sites and browsers in a simple table.
4. Install links for Chrome and Firefox.
5. Basic usage: open a supported product page, open the extension, preview, export.
6. What gets exported: symbol, footprint, 3D model, datasheet, KiCad library layout.
7. Known limitations and sign-in requirements.
8. Firefox advanced relay section.
9. Security and privacy summary.
10. Developer setup and tests.
11. Supporting docs.

### Step 8: Make It More Discoverable

Add naturally searchable wording without turning the README into keyword stuffing.

Search terms to include where accurate:

- KiCad symbol download
- KiCad footprint download
- KiCad 3D model export
- LCSC to KiCad
- JLCPCB EasyEDA to KiCad
- Mouser KiCad CAD model
- Farnell KiCad CAD model
- EasyEDA CAD export
- SamacSys KiCad export
- browser extension for electronics CAD

### Step 9: Add User-Facing Clarity

The README should clearly answer:

- Which sites are supported?
- Which browser should I use?
- Do I need to sign in?
- Why does Firefox need a relay for some exports?
- Where do downloaded files go?
- What is the difference between loose files and KiCad library mode?
- Are generated CAD files guaranteed to be correct?
- What data is stored locally?

## Phase 4: Security Tightening

### Step 10: Narrow Extension Permissions

Current issue:

- `manifest.json` grants broad `http://*/*` and `https://*/*` host permissions with `cookies` and `webRequest`.

Target state:

- Restrict host permissions to known supported domains where practical.
- Consider optional permissions for advanced relay usage.
- Add tests that assert the intended permission list.
- Document why each permission exists.

### Step 11: Make Relay URLs HTTPS-First

Current issue:

- Relay/proxy URL parsing accepts `http:` and `https:`.
- Relay requests may carry auth headers or cookies.

Target state:

- Allow `https:` for normal relay URLs.
- Allow `http://localhost` only for local development if needed.
- Update tests, popup validation text, `systemDesign.md`, and `docs/firefox-samacsys-proxy.md`.

### Step 12: Tighten Page Detection

Current issues:

- LCSC fallback detection can pick any `C123`-style token from the full page body.
- Farnell SamacSys detection can use the first `componentsearchengine.com` link anywhere on the page.

Target state:

- Prefer structured product-page regions and provider-specific metadata.
- Return `not found` rather than choosing ambiguous IDs.
- Scope SamacSys links to expected ECAD/MCAD sections.
- Add regression tests for pages with multiple possible part IDs or unrelated SamacSys links.

### Step 13: Improve Stored Credential Controls

Target state:

- Add a `Clear stored auth` control.
- Wipe SamacSys username, password, relay auth, manual upstream auth, and captured upstream auth together.
- Add warning copy that credentials are stored in extension local storage.
- Add popup and settings tests for clearing stored auth.

### Step 14: Strengthen CI and Release Security

Target state:

- Add `permissions: contents: read` to CI workflows.
- Consider pinning GitHub Actions by SHA.
- Add `web-ext lint` or equivalent browser-extension linting.
- Add a packaging validation job.
- Consider adding `gitleaks` while keeping the current repo hygiene test as a lightweight backstop.
- Add a release checklist covering version bump, changelog, package validation, store notes, and rollback notes.

## Phase 5: Implementation Order

1. Complete the feature audit and decide whether SamacSys and Firefox relay support are first-class features.
2. Choose the project name and scope statement.
3. Tighten permissions and relay URL handling before making broader marketing claims.
4. Add stored-auth clearing and clearer security copy.
5. Tighten LCSC and Farnell detection behavior.
6. Rewrite `README.md` around the chosen name and supported workflows.
7. Update `systemDesign.md`, `CHANGELOG.md`, and supporting docs to match the implemented behavior.
8. Add packaging/runtime validation to CI.
9. Run `npm run validate`.
10. Prepare store listing copy and screenshots based on the new README.

## Decision Log Template

Use this for each major decision before implementation:

| Decision | Options considered | Chosen option | Reason | Files to update |
| --- | --- | --- | --- | --- |
| Project scope | EasyEDA-only, distributor-to-KiCad, broader CAD downloader | TBD | TBD | README, manifest, systemDesign |
| Project name | TBD | TBD | TBD | README, manifest, store listings |
| SamacSys support | Keep, change, remove, defer | TBD | TBD | sources, tests, README, systemDesign |
| Firefox relay | Keep advanced, remove, redesign | TBD | TBD | settings, docs, tests |
| Stored auth | Keep with controls, remove, session-only | TBD | TBD | popup, settings, tests, SECURITY |

## Definition of Done

- Feature decisions are recorded.
- Project name and scope are consistent across repo docs and user-facing extension metadata.
- README is understandable to a non-technical electronics user.
- README contains accurate search-friendly wording for supported workflows.
- Security-sensitive behavior has tests and clear documentation.
- CI validates lint, tests, audit, whitespace, and extension packaging.
- `npm run validate` passes.
