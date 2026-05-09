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
  "CHANGELOG.md",
  "SECURITY.md",
  "systemDesign.md",
  "docs/architecture-notes.md",
  "docs/deviations.md"
];

const SKIPPED_REPOSITORY_DIRS = new Set([".git", "coverage", "node_modules"]);

const FORBIDDEN_ARTIFACT_PATTERNS = [
  { label: "local environment file", pattern: /(^|\/)\.env(?:\..*)?$/ },
  { label: "generated extension archive", pattern: /\.(?:crx|xpi|zip)$/i },
  { label: "archive artifact", pattern: /\.(?:tar|tgz|tar\.gz|7z|rar)$/i },
  { label: "private key or certificate bundle", pattern: /\.(?:key|p12|pfx|pem)$/i },
  { label: "local log file", pattern: /\.log$/i },
  { label: "patch reject file", pattern: /\.rej$/i },
  { label: "merge backup file", pattern: /\.(?:orig|bak|backup|old)$/i },
  { label: "temporary file", pattern: /\.(?:tmp|temp)$/i },
  { label: "editor swap file", pattern: /\.(?:swp|swo)$/i },
  { label: "editor backup file", pattern: /~$/ },
  { label: "macOS metadata file", pattern: /(^|\/)\.DS_Store$/ },
  { label: "Windows metadata file", pattern: /(^|\/)(?:Thumbs\.db|desktop\.ini)$/i },
  { label: "SSH private key", pattern: /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/ }
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml"
]);

const TEXT_FILE_NAMES = new Set([".gitignore", "AGENTS.md", "LICENSE"]);

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  { label: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "AWS temporary access key id", pattern: /ASIA[0-9A-Z]{16}/ },
  { label: "GitLab token", pattern: /glpat-[A-Za-z0-9_-]{20,}/ },
  { label: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "OpenAI project or service token", pattern: /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/ },
  { label: "OpenAI legacy token", pattern: /sk-[A-Za-z0-9]{32,}/ },
  { label: "Anthropic API token", pattern: /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}/ },
  { label: "Stripe live secret key", pattern: /(?:sk|rk)_live_[A-Za-z0-9]{24,}/ },
  { label: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { label: "Slack webhook URL", pattern: /hooks\.slack\.com\/services\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{20,}/ },
  { label: "npm token", pattern: /npm_[A-Za-z0-9]{36}/ },
  { label: "SendGrid API token", pattern: /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { label: "JWT bearer token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ }
];

const CONVENTIONAL_ROOT_FILES = new Set([
  ".gitignore",
  ".nvmrc",
  "AGENTS.md",
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "contributing.md",
  "eslint.config.js",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "systemDesign.md",
  "vitest.config.js"
]);

const FILE_LENGTH_EXCEPTIONS = new Set(["LICENSE", "package-lock.json"]);

const BINARY_EXTENSIONS = new Set([".png"]);

const CAMEL_CASE_FUNCTION_NAME = /^[a-z][A-Za-z0-9]*$/;

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

function repositoryFiles() {
  const files = [];

  function walk(directoryPath) {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_REPOSITORY_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(REPO_ROOT);
  return files.sort();
}

function repoRelativePath(fullPath) {
  return path.relative(REPO_ROOT, fullPath).replaceAll(path.sep, "/");
}

function isTextFile(relativePath) {
  return (
    TEXT_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) ||
    TEXT_FILE_NAMES.has(path.basename(relativePath))
  );
}

function isLowerSnakeFileName(filename) {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.test)?\.js$/.test(filename);
}

function isLowerKebabFileName(filename, extensionPattern) {
  return new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*\\.${extensionPattern}$`).test(
    filename
  );
}

function expectedFileNameStyle(relativePath) {
  const filename = path.basename(relativePath);
  const directoryName = path.dirname(relativePath).replaceAll(path.sep, "/");
  const extension = path.extname(filename).toLowerCase();

  if (CONVENTIONAL_ROOT_FILES.has(relativePath)) {
    return null;
  }
  if (relativePath === ".github/workflows/ci.yml") {
    return null;
  }
  if (directoryName === "icons" && /^\d+x\d+\.png$/.test(filename)) {
    return null;
  }
  if (directoryName === "docs" && extension === ".md") {
    return { label: "docs Markdown should use lower kebab-case", isValid: isLowerKebabFileName(filename, "md") };
  }
  if ((directoryName.startsWith("src") || directoryName.startsWith("tests")) && extension === ".js") {
    return { label: "JavaScript should use lower snake_case", isValid: isLowerSnakeFileName(filename) };
  }
  if (directoryName.startsWith("src") && [".css", ".html"].includes(extension)) {
    return {
      label: "source assets should use lower kebab-case or lower snake_case",
      isValid: /^[a-z0-9]+(?:[_-][a-z0-9]+)*\.(?:css|html)$/.test(filename)
    };
  }
  if (directoryName === "src/assets" && extension === ".png") {
    return { label: "source image assets should use lower kebab-case", isValid: isLowerKebabFileName(filename, "png") };
  }

  return null;
}

function lineLimitFor(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();

  if (FILE_LENGTH_EXCEPTIONS.has(relativePath) || BINARY_EXTENSIONS.has(extension)) {
    return null;
  }
  if (relativePath.startsWith("src/") && extension === ".js") {
    return 700;
  }
  if (relativePath.startsWith("tests/") && extension === ".js") {
    return 750;
  }
  if (extension === ".md") {
    return 450;
  }
  if ([".css", ".html", ".json", ".yml"].includes(extension)) {
    return 450;
  }

  return null;
}

function functionDeclarationNames(text) {
  return [...text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1]);
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
    expect(manifest.options_ui).toEqual({
      page: "src/settings.html",
      open_in_tab: true
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

  it("keeps secrets, generated archives, and disposable files out of the repository tree", () => {
    const forbiddenFiles = [];

    for (const fullPath of repositoryFiles()) {
      const relativePath = repoRelativePath(fullPath);
      const match = FORBIDDEN_ARTIFACT_PATTERNS.find(({ pattern }) =>
        pattern.test(relativePath)
      );
      if (match) {
        forbiddenFiles.push(`${relativePath} (${match.label})`);
      }
    }

    expect(forbiddenFiles).toEqual([]);
  });

  it("does not contain high-confidence secret material in text files", () => {
    const findings = [];

    for (const fullPath of repositoryFiles()) {
      const relativePath = repoRelativePath(fullPath);
      if (!isTextFile(relativePath)) {
        continue;
      }

      const text = fs.readFileSync(fullPath, "utf8");
      for (const { label, pattern } of HIGH_CONFIDENCE_SECRET_PATTERNS) {
        if (pattern.test(text)) {
          findings.push(`${relativePath} (${label})`);
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it("keeps file names in the repository's conventional styles", () => {
    const violations = [];

    for (const fullPath of repositoryFiles()) {
      const relativePath = repoRelativePath(fullPath);
      const expectation = expectedFileNameStyle(relativePath);
      if (expectation && !expectation.isValid) {
        violations.push(`${relativePath} (${expectation.label})`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps function declaration names in lower camelCase", () => {
    const violations = [];

    for (const fullPath of applicableSourceFiles()) {
      const relativePath = repoRelativePath(fullPath);
      const text = fs.readFileSync(fullPath, "utf8");
      for (const name of functionDeclarationNames(text)) {
        if (!CAMEL_CASE_FUNCTION_NAME.test(name)) {
          violations.push(`${relativePath}: ${name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps maintained text files below the repository line-count limits", () => {
    const oversizedFiles = [];

    for (const fullPath of repositoryFiles()) {
      const relativePath = repoRelativePath(fullPath);
      const limit = lineLimitFor(relativePath);
      if (!limit) {
        continue;
      }
      const lineCount = normalizeNewlines(fs.readFileSync(fullPath, "utf8")).split("\n").length;
      if (lineCount > limit) {
        oversizedFiles.push(`${relativePath} (${lineCount}/${limit} lines)`);
      }
    }

    expect(oversizedFiles).toEqual([]);
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

    expect(deviationsText).toContain("samacsysFirefoxAuthorizationHeader");
    expect(deviationsText).toContain("settings page no longer exposes");
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
