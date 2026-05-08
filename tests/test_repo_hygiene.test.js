/*
 * These tests cover repository-level governance rules. They inspect tracked
 * docs, manifest shape, source footers, and reviewer explainers so convention
 * drift is caught mechanically rather than by memory.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, normalizeNewlines } from "./helpers/test_harness.js";

const GOVERNANCE_FILES = [
  "AGENTS.md",
  "SECURITY.md",
  "systemDesign.md",
  "docs/architecture-notes.md",
  "docs/deviations.md"
];

const CANONICAL_FOOTER = normalizeNewlines(
  [
    "/*",
    "######################################################################################################################",
    "",
    "",
    "                                        AAAAAAAA",
    "                                      AAAA    AAAAA              AAAAAAAA",
    "                                    AAA          AAA           AAAA    AAA",
    "                                    AA            AA          AAA       AAA",
    "                                    AA            AAAAAAAAAA  AAA       AAAAAAAAAA",
    "                                    AAA                  AAA  AAA               AA",
    "                                     AAA                AAA    AAAAA            AA",
    "                                      AAAAA            AAA        AAA           AA",
    "                                         AAA          AAA                       AA",
    "                                         AAA         AAA                        AA",
    "                                         AA         AAA                         AA",
    "                                         AA        AAA                          AA",
    "                                        AAA       AAAAAAAAA                     AA",
    "                                        AAA       AAAAAAAAA                     AA",
    "                                        AA                   AAAAAAAAAAAAAA     AA",
    "                                        AA  AAAAAAAAAAAAAAAAAAAAAAAA    AAAAAAA AA",
    "                                       AAAAAAAAAAA                           AA AA",
    "                                                                           AAA  AA",
    "                                                                         AAAA   AA",
    "                                                                      AAAA      AA",
    "                                                                   AAAAA        AA",
    "                                                               AAAAA            AA",
    "                                                            AAAAA               AA",
    "                                                        AAAAAA                  AA",
    "                                                    AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "",
    "",
    "######################################################################################################################",
    "",
    "                                                Copyright (c) JoeShade",
    "                              Licensed under the GNU Affero General Public License v3.0",
    "",
    "######################################################################################################################",
    "",
    "                                        +44 (0) 7356 042702 | joe@jshade.co.uk",
    "",
    "######################################################################################################################",
    "*/"
  ].join("\n")
);

function applicableSourceFiles() {
  const files = [];

  for (const root of ["src", "tests"]) {
    const basePath = path.join(REPO_ROOT, root);
    if (!fs.existsSync(basePath)) {
      continue;
    }
    for (const entry of fs.readdirSync(basePath, { recursive: true })) {
      const fullPath = path.join(basePath, entry);
      if (fs.statSync(fullPath).isFile() && fullPath.endsWith(".js")) {
        files.push(fullPath);
      }
    }
  }

  const supportFiles = [
    path.join(REPO_ROOT, "eslint.config.js"),
    path.join(REPO_ROOT, "vitest.config.js")
  ];
  for (const fullPath of supportFiles) {
    if (fs.existsSync(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function hasTopLevelExplainer(text) {
  const normalized = normalizeNewlines(text)
    .trimStart()
    .replace(/^\/\/ .+work in this file: .+\n/, "");
  return /^\/\*\n \* [\s\S]*?\n \*\//.test(normalized);
}

describe("repository hygiene", () => {
  it("requires the governance files", () => {
    for (const relativePath of GOVERNANCE_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, relativePath))).toBe(true);
    }
  });

  it("keeps the manifest aligned for Chrome service workers and Firefox background documents", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8")
    );

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({
      service_worker: "src/service_worker.js",
      scripts: ["src/service_worker.js"],
      preferred_environment: ["document", "service_worker"],
      type: "module"
    });
    expect(manifest.browser_specific_settings?.gecko?.strict_min_version).toBe(
      "121.0"
    );
  });

  it("keeps README sections in the documented review order", () => {
    const readmeText = normalizeNewlines(
      fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8")
    );
    const expectedOrder = [
      "# EasyEDA Downloader",
      "## Introduction",
      "## Disclaimer",
      "## Set-up",
      "## Usage",
      "## Contributing",
      "## Supporting docs"
    ];

    let previousIndex = -1;
    for (const heading of expectedOrder) {
      const currentIndex = readmeText.indexOf(heading);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("keeps the local and CI validation gates wired together", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
    const workflowText = normalizeNewlines(
      fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")
    );

    expect(fs.existsSync(path.join(REPO_ROOT, "package-lock.json"))).toBe(true);
    expect(packageJson.scripts.lint).toBe("eslint .");
    expect(packageJson.scripts.audit).toBe("npm audit --audit-level=moderate");
    expect(packageJson.scripts.validate).toContain("npm run lint");
    expect(packageJson.scripts.validate).toContain("npm test");
    expect(packageJson.scripts.validate).toContain("npm run audit");
    expect(packageJson.scripts.validate).toContain("git diff --check");
    expect(workflowText).toContain("npm ci");
    expect(workflowText).toContain("npm run validate");
  });

  it("keeps the canonical footer on applicable maintained JS files exactly once", () => {
    const missingOrDuplicated = [];

    for (const fullPath of applicableSourceFiles()) {
      const text = normalizeNewlines(fs.readFileSync(fullPath, "utf8"));
      const occurrences = text.split(CANONICAL_FOOTER).length - 1;
      if (occurrences !== 1) {
        missingOrDuplicated.push(path.relative(REPO_ROOT, fullPath));
      }
    }

    expect(missingOrDuplicated).toEqual([]);
  });

  it("keeps a top-level explainer on applicable maintained JS files", () => {
    const missingExplainers = [];

    for (const fullPath of applicableSourceFiles()) {
      const text = fs.readFileSync(fullPath, "utf8");
      if (!hasTopLevelExplainer(text)) {
        missingExplainers.push(path.relative(REPO_ROOT, fullPath));
      }
    }

    expect(missingExplainers).toEqual([]);
  });

  it("keeps deviations focused on live mismatches rather than backlog or history", () => {
    const deviationsText = normalizeNewlines(
      fs.readFileSync(path.join(REPO_ROOT, "docs/deviations.md"), "utf8")
    );

    expect(deviationsText).toContain(
      "No material code/design mismatches are intentionally tracked at this time."
    );
    expect(deviationsText).not.toMatch(/^\s*[-*]\s+/m);
    expect(deviationsText).not.toMatch(/^\s*\d+\.\s+/m);
    expect(deviationsText.trim().split("\n").length).toBeLessThanOrEqual(6);
  });

  it("does not keep stale footer migration language in governance docs", () => {
    const governanceText = GOVERNANCE_FILES.map((relativePath) =>
      normalizeNewlines(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"))
    ).join("\n");

    expect(governanceText).not.toContain("removed `source-code-footer.txt`");
    expect(governanceText).not.toContain("copy an existing source file");
    expect(governanceText.toLowerCase()).not.toContain("footer migration");
  });
});

/*
######################################################################################################################


                                        AAAAAAAA
                                      AAAA    AAAAA              AAAAAAAA
                                    AAA          AAA           AAAA    AAA
                                    AA            AA          AAA       AAA
                                    AA            AAAAAAAAAA  AAA       AAAAAAAAAA
                                    AAA                  AAA  AAA               AA
                                     AAA                AAA    AAAAA            AA
                                      AAAAA            AAA        AAA           AA
                                         AAA          AAA                       AA
                                         AAA         AAA                        AA
                                         AA         AAA                         AA
                                         AA        AAA                          AA
                                        AAA       AAAAAAAAA                     AA
                                        AAA       AAAAAAAAA                     AA
                                        AA                   AAAAAAAAAAAAAA     AA
                                        AA  AAAAAAAAAAAAAAAAAAAAAAAA    AAAAAAA AA
                                       AAAAAAAAAAA                           AA AA
                                                                           AAA  AA
                                                                         AAAA   AA
                                                                      AAAA      AA
                                                                   AAAAA        AA
                                                               AAAAA            AA
                                                            AAAAA               AA
                                                        AAAAAA                  AA
                                                    AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA


######################################################################################################################

                                                Copyright (c) JoeShade
                              Licensed under the GNU Affero General Public License v3.0

######################################################################################################################

                                        +44 (0) 7356 042702 | joe@jshade.co.uk

######################################################################################################################
*/
