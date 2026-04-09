/*
 * This content script runs in JLCPCB/LCSC pages and tries to
 * locate the LCSC part number by scanning common page layouts. It looks in
 * definition lists and table rows first, then falls back to a full-page scan.
 */

// Normalize a label so we can compare it reliably.
function normalizeLabel(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesKnownLabel(label, expectedLabels) {
  return expectedLabels.some((expectedLabel) => label.includes(expectedLabel));
}

function normalizeDetectedValue(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value || null;
}

// Pull the LCSC part id (e.g., C12345) out of a text string.
function extractLcscId(text) {
  if (!text) {
    return null;
  }
  const match = text.toUpperCase().match(/C\d{3,}/);
  return match ? match[0] : null;
}

function extractManufacturerPartNumber(text) {
  return normalizeDetectedValue(text);
}

function findTextInDefinitionLists(expectedLabels) {
  const lists = document.querySelectorAll("dl");
  for (const list of lists) {
    const dt = list.querySelector("dt");
    const dd = list.querySelector("dd");
    if (!dt || !dd) {
      continue;
    }
    const label = normalizeLabel(dt.textContent || "");
    if (matchesKnownLabel(label, expectedLabels)) {
      return normalizeDetectedValue(dd.textContent);
    }
  }
  return null;
}

function findTextInTables(expectedLabels) {
  const rows = document.querySelectorAll("table.tableInfoWrap tr");
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) {
      continue;
    }
    const label = normalizeLabel(cells[0].textContent || "");
    if (matchesKnownLabel(label, expectedLabels)) {
      return normalizeDetectedValue(cells[1].textContent);
    }
  }
  return null;
}

// Search definition list entries (<dl><dt><dd>) for the part number.
function findInDefinitionLists() {
  const value = findTextInDefinitionLists(["jlcpcb part #", "lcsc part #"]);
  return extractLcscId(value);
}

// Search the common product table layout for the part number.
function findInTables() {
  const value = findTextInTables(["lcsc part #"]);
  return extractLcscId(value);
}

function findManufacturerPartNumberInDefinitionLists() {
  return extractManufacturerPartNumber(findTextInDefinitionLists(["mfr. part #"]));
}

function findManufacturerPartNumberInTables() {
  return extractManufacturerPartNumber(findTextInTables(["mfr. part #"]));
}

function findManufacturerPartNumber() {
  return (
    findManufacturerPartNumberInDefinitionLists() ||
    findManufacturerPartNumberInTables()
  );
}

// Try the targeted searches first, then scan the entire page as a fallback.
function findLcscId() {
  return findInDefinitionLists() || findInTables() || extractLcscId(document.body.textContent);
}

// Listen for extension messages and reply with the detected LCSC id.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LCSC_ID") {
    return false;
  }

  const lcscId = findLcscId();
  const manufacturerPartNumber = findManufacturerPartNumber();
  sendResponse({ lcscId, manufacturerPartNumber });
  return true;
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
