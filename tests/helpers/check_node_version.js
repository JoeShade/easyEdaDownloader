/*
 * This helper keeps test startup failures actionable by checking the local
 * Node.js version before Vitest boots. The current Vitest/Vite/jsdom stack
 * requires Node 20.19+, 22.13+, or 24+.
 */

function parseNodeVersion(version) {
  const [major = 0, minor = 0, patch = 0] = String(version || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

function isSupportedNodeVersion(version) {
  const { major, minor } = parseNodeVersion(version);
  if (major >= 24) {
    return true;
  }
  if (major === 22) {
    return minor >= 13;
  }
  if (major === 20) {
    return minor >= 19;
  }
  return false;
}

const currentVersion = process.versions.node;

if (!isSupportedNodeVersion(currentVersion)) {
  console.error(
    [
      "Unsupported Node.js version for this repository's test tooling.",
      `Detected: ${currentVersion}`,
      "Use Node 22.13.0+ (recommended), Node 20.19.0+, or Node 24+.",
      "The current Vitest/Vite/jsdom stack will fail before running tests on unsupported Node versions.",
      "If you use nvm, this repo includes .nvmrc."
    ].join("\n")
  );
  process.exit(1);
}

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
