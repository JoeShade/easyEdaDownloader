/*
 * Storage-backed KiCad symbol-library helpers. Library mode keeps the current
 * merged symbol text in chrome.storage.local so repeated exports can append or
 * replace symbol blocks without touching the local filesystem directly.
 */

function extractSymbolBlock(kicadLibraryText) {
  const start = kicadLibraryText.indexOf("(symbol \"");
  if (start === -1) {
    return null;
  }
  const end = kicadLibraryText.lastIndexOf("\n)");
  if (end === -1 || end <= start) {
    return null;
  }
  return kicadLibraryText.slice(start, end).trim();
}

function mergeSymbolIntoLibrary(existingLibrary, symbolBlock, symbolId) {
  if (!symbolBlock) {
    return existingLibrary;
  }
  if (!existingLibrary) {
    return `(kicad_symbol_lib\n  (version 20211014)\n  (generator "easy EDA downloader")\n  ${symbolBlock.replace(/\n/g, "\n  ")}\n)\n`;
  }
  if (existingLibrary.includes(`(symbol "${symbolId}"`)) {
    return existingLibrary;
  }
  const trimmed = existingLibrary.trimEnd();
  const lastClose = trimmed.lastIndexOf(")");
  if (lastClose === -1) {
    return existingLibrary;
  }
  const before = trimmed.slice(0, lastClose).trimEnd();
  const indentedBlock = `  ${symbolBlock.replace(/\n/g, "\n  ")}`;
  return `${before}\n${indentedBlock}\n)\n`;
}

function parseKicadSymbolName(symbolLibraryText) {
  const match = String(symbolLibraryText || "").match(/\(symbol "([^"]+)"/);
  return match ? match[1] : null;
}

async function loadStoredSymbolLibrary(chromeApi, key) {
  return new Promise((resolve) => {
    chromeApi.storage.local.get({ [key]: "" }, (data) => {
      if (chromeApi.runtime.lastError) {
        console.warn("Failed to load symbol library:", chromeApi.runtime.lastError);
        resolve("");
        return;
      }
      resolve(String(data[key] || ""));
    });
  });
}

async function saveStoredSymbolLibrary(chromeApi, key, content) {
  return new Promise((resolve) => {
    chromeApi.storage.local.set({ [key]: content }, () => {
      if (chromeApi.runtime.lastError) {
        console.warn("Failed to save symbol library:", chromeApi.runtime.lastError);
      }
      resolve();
    });
  });
}

export {
  extractSymbolBlock,
  mergeSymbolIntoLibrary,
  parseKicadSymbolName,
  loadStoredSymbolLibrary,
  saveStoredSymbolLibrary
};

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
