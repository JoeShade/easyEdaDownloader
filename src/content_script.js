/*
 * This content script inspects supported product pages and returns a provider-
 * aware part context for the popup. EasyEDA/LCSC pages expose an LCSC part id,
 * while Mouser pages expose SamacSys lookup metadata through the ECAD button.
 */

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";
const MOUSER_SOURCE_LABEL = "Mouser part";
const EASYEDA_SOURCE_LABEL = "LCSC part";
const MOUSER_ENTRY_ORIGIN = "https://ms.componentsearchengine.com";

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

function buildQueryString(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");
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

function getInputValue(id) {
  const input = document.getElementById(id);
  return normalizeDetectedValue(input?.value);
}

function getTextContent(selector) {
  const element = document.querySelector(selector);
  return normalizeDetectedValue(element?.textContent);
}

function extractEventValueFromOnclick(onclickText, key) {
  const text = String(onclickText || "");
  const match = text.match(new RegExp(`"${key}":"([^"]*)"`, "i"));
  return normalizeDetectedValue(match?.[1] || "");
}

function parseLoadPartDivCall(onclickText) {
  const text = String(onclickText || "");
  const match = text.match(
    /loadPartDiv\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*[^,]+,\s*"([^"]*)"\s*,\s*[^,]+,\s*"([^"]*)"\s*,\s*"([^"]*)"/i
  );
  if (!match) {
    return null;
  }
  return {
    manufacturerName: normalizeDetectedValue(match[1]),
    manufacturerPartNumber: normalizeDetectedValue(match[2]),
    partnerName: normalizeDetectedValue(match[3]),
    format: normalizeDetectedValue(match[4]),
    logo: normalizeDetectedValue(match[5]),
    lang: normalizeDetectedValue(match[6])
  };
}

function buildMouserEntryUrl(loadPartDivData) {
  if (!loadPartDivData?.manufacturerName || !loadPartDivData?.manufacturerPartNumber) {
    return null;
  }

  const queryString = buildQueryString({
    mna: loadPartDivData.manufacturerName,
    mpn: loadPartDivData.manufacturerPartNumber,
    pna: "mouser",
    vrq: "multi",
    fmt: "zip",
    logo: loadPartDivData.logo,
    lang: loadPartDivData.lang
  });
  return `${MOUSER_ENTRY_ORIGIN}/entry_u_newDesign.php?${queryString}`;
}

function findMouserPartNumber(ecadButton) {
  return (
    getInputValue("MouserPartNumFormattedForProdInfo") ||
    getTextContent("#spnMouserPartNumFormattedForProdInfo") ||
    normalizeDetectedValue(
      extractEventValueFromOnclick(ecadButton?.getAttribute("onclick"), "event_mouserpn")
    )?.toUpperCase() ||
    null
  );
}

function findMouserManufacturerPartNumber(ecadButton) {
  return (
    getInputValue("ManufacturerPartNumber") ||
    getTextContent("#spnManufacturerPartNumber") ||
    normalizeDetectedValue(
      extractEventValueFromOnclick(
        ecadButton?.getAttribute("onclick"),
        "event_manufacturerpn"
      )
    )?.toUpperCase() ||
    null
  );
}

function findMouserPartContext() {
  const ecadButton = document.querySelector(
    '#lnk_CadModel[data-testid="ProductInfoECAD"]'
  );
  if (!ecadButton) {
    return null;
  }

  const onclickText = ecadButton.getAttribute("onclick") || "";
  const loadPartDivData = parseLoadPartDivCall(onclickText);
  const sourcePartNumber = findMouserPartNumber(ecadButton);
  const manufacturerPartNumber =
    findMouserManufacturerPartNumber(ecadButton) ||
    loadPartDivData?.manufacturerPartNumber ||
    null;
  const manufacturerName =
    loadPartDivData?.manufacturerName ||
    extractEventValueFromOnclick(onclickText, "event_manufacturer") ||
    null;
  const entryUrl = buildMouserEntryUrl({
    ...loadPartDivData,
    manufacturerName,
    manufacturerPartNumber
  });

  if (!sourcePartNumber || !entryUrl) {
    return null;
  }

  return {
    provider: MOUSER_PROVIDER,
    sourcePartLabel: MOUSER_SOURCE_LABEL,
    sourcePartNumber,
    manufacturerPartNumber,
    lookup: {
      manufacturerName,
      entryUrl
    }
  };
}

function findEasyedaPartContext() {
  const lcscId = findLcscId();
  if (!lcscId) {
    return null;
  }

  return {
    provider: EASYEDA_PROVIDER,
    sourcePartLabel: EASYEDA_SOURCE_LABEL,
    sourcePartNumber: lcscId,
    manufacturerPartNumber: findManufacturerPartNumber(),
    lookup: {
      lcscId
    }
  };
}

function findPartContext() {
  return (
    findMouserPartContext() ||
    findEasyedaPartContext() || {
      provider: null,
      sourcePartLabel: null,
      sourcePartNumber: null,
      manufacturerPartNumber: null,
      lookup: null
    }
  );
}

// Listen for extension messages and reply with the detected part context.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_PART_CONTEXT") {
    return false;
  }

  sendResponse(findPartContext());
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
