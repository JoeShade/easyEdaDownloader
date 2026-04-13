/*
 * This content script inspects supported product pages and returns a provider-
 * aware part context for the popup. EasyEDA/LCSC pages expose an LCSC part id,
 * while SamacSys distributor pages expose lookup metadata through page-specific
 * ECAD entry points.
 */

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";
const FARNELL_PROVIDER = "farnellSamacsys";
const MOUSER_SOURCE_LABEL = "Mouser part";
const FARNELL_SOURCE_LABEL = "Farnell part";
const EASYEDA_SOURCE_LABEL = "LCSC part";
const MOUSER_ENTRY_ORIGIN = "https://ms.componentsearchengine.com";
const FARNELL_ENTRY_ORIGIN = "https://farnell.componentsearchengine.com";

function isEasyedaHost() {
  return /(^|\.)((lcsc|jlcpcb)\.com)$/i.test(window.location.hostname);
}

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

function getMetaContent(attribute, value) {
  const element = document.querySelector(`meta[${attribute}="${value}"]`);
  return normalizeDetectedValue(element?.getAttribute("content"));
}

function getLinkHref(rel) {
  const element = document.querySelector(`link[rel="${rel}"]`);
  return normalizeDetectedValue(element?.getAttribute("href"));
}

function findExactTextInDefinitionLists(expectedLabels) {
  const normalizedExpectedLabels = expectedLabels.map((label) => normalizeLabel(label));
  const lists = document.querySelectorAll("dl");
  for (const list of lists) {
    const dt = list.querySelector("dt");
    const dd = list.querySelector("dd");
    if (!dt || !dd) {
      continue;
    }
    const label = normalizeLabel(dt.textContent || "");
    if (normalizedExpectedLabels.includes(label)) {
      return normalizeDetectedValue(dd.textContent);
    }
  }
  return null;
}

function findExactTextInTables(expectedLabels) {
  const normalizedExpectedLabels = expectedLabels.map((label) => normalizeLabel(label));
  const rows = document.querySelectorAll("table.tableInfoWrap tr");
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) {
      continue;
    }
    const label = normalizeLabel(cells[0].textContent || "");
    if (normalizedExpectedLabels.includes(label)) {
      return normalizeDetectedValue(cells[1].textContent);
    }
  }
  return null;
}

function getQueryParamValue(...keys) {
  const url = new URL(window.location.href);
  for (const key of keys) {
    const value = normalizeDetectedValue(url.searchParams.get(key));
    if (value) {
      return value;
    }
  }
  return null;
}

function parseFarnellDescriptionProductData() {
  const description =
    getMetaContent("property", "og:description") || getMetaContent("name", "description");
  const match = description?.match(/Buy\s+(.+?)\s*-\s*(.+?)\s*-\s*/i);
  if (!match) {
    return null;
  }

  return {
    manufacturerPartNumber: normalizeDetectedValue(match[1]),
    manufacturerName: normalizeDetectedValue(match[2])
  };
}

function parseFarnellImageAltProductData() {
  const imageAlt = getMetaContent("property", "og:image:alt");
  const match = imageAlt?.match(/^(.+?)\s+([A-Z0-9][A-Z0-9./_+\-]*)$/i);
  if (!match) {
    return null;
  }

  return {
    manufacturerName: normalizeDetectedValue(match[1]),
    manufacturerPartNumber: normalizeDetectedValue(match[2])
  };
}

function parseFarnellPathProductData() {
  let url;
  try {
    url = new URL(
      getLinkHref("canonical") ||
        getMetaContent("property", "og:url") ||
        window.location.href
    );
  } catch (error) {
    return null;
  }

  const pathnameMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/.+\/dp\/([^/?#]+)/i);
  if (!pathnameMatch) {
    return null;
  }

  const [, manufacturerSlug, manufacturerPartSlug, sourcePartNumber] = pathnameMatch;
  return {
    manufacturerName: normalizeDetectedValue(
      decodeURIComponent(manufacturerSlug).replace(/-/g, " ").toUpperCase()
    ),
    manufacturerPartNumber: normalizeDetectedValue(
      decodeURIComponent(manufacturerPartSlug).toUpperCase()
    ),
    sourcePartNumber: normalizeDetectedValue(decodeURIComponent(sourcePartNumber))
  };
}

function findFarnellProductData() {
  const descriptionData = parseFarnellDescriptionProductData();
  const imageAltData = parseFarnellImageAltProductData();
  const pathData = parseFarnellPathProductData();

  return {
    manufacturerName:
      descriptionData?.manufacturerName ||
      imageAltData?.manufacturerName ||
      findExactTextInDefinitionLists(["Manufacturer"]) ||
      findExactTextInTables(["Manufacturer"]) ||
      pathData?.manufacturerName ||
      null,
    manufacturerPartNumber:
      descriptionData?.manufacturerPartNumber ||
      imageAltData?.manufacturerPartNumber ||
      findExactTextInDefinitionLists(["Manufacturer Part No", "Mfr. Part #"]) ||
      findExactTextInTables(["Manufacturer Part No", "Mfr. Part #"]) ||
      pathData?.manufacturerPartNumber ||
      null,
    sourcePartNumber:
      findExactTextInDefinitionLists(["Order Code", "Farnell Part No", "Farnell No"]) ||
      findExactTextInTables(["Order Code", "Farnell Part No", "Farnell No"]) ||
      pathData?.sourcePartNumber ||
      getQueryParamValue("partNumber", "productId")
  };
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

function buildSamacsysEntryUrl({
  baseUrl = MOUSER_ENTRY_ORIGIN,
  manufacturerName,
  manufacturerPartNumber,
  partnerName,
  logo,
  lang
}) {
  if (!manufacturerName || !manufacturerPartNumber || !partnerName) {
    return null;
  }

  const queryString = buildQueryString({
    mna: manufacturerName,
    mpn: manufacturerPartNumber,
    pna: partnerName,
    vrq: "multi",
    fmt: "zip",
    logo,
    lang
  });
  return `${baseUrl}/entry_u_newDesign.php?${queryString}`;
}

function parseSamacsysLinkUrl(url, fallbackPartnerName = null) {
  if (!url) {
    return null;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url, window.location.href);
  } catch (error) {
    return null;
  }
  if (!/componentsearchengine\.com$/i.test(parsedUrl.hostname)) {
    return null;
  }

  return {
    baseUrl: parsedUrl.origin,
    manufacturerName: normalizeDetectedValue(parsedUrl.searchParams.get("mna")),
    manufacturerPartNumber: normalizeDetectedValue(parsedUrl.searchParams.get("mpn")),
    partnerName:
      normalizeDetectedValue(parsedUrl.searchParams.get("pna")) || fallbackPartnerName,
    logo: normalizeDetectedValue(parsedUrl.searchParams.get("logo")),
    lang: normalizeDetectedValue(parsedUrl.searchParams.get("lang"))
  };
}

function findSamacsysLinkElement() {
  return (
    document.querySelector('a[href*="componentsearchengine.com/"]') ||
    document.querySelector('a img[alt*="Supply Frame Models Link" i]')?.closest("a") ||
    null
  );
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
  const entryUrl = buildSamacsysEntryUrl({
    baseUrl: MOUSER_ENTRY_ORIGIN,
    manufacturerName,
    manufacturerPartNumber,
    partnerName: "mouser",
    logo: loadPartDivData?.logo,
    lang: loadPartDivData?.lang
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
      entryUrl,
      partnerName: "mouser",
      samacsysBaseUrl: MOUSER_ENTRY_ORIGIN
    }
  };
}

function findFarnellPartContext() {
  const samacsysLink = findSamacsysLinkElement();
  const linkMetadata = parseSamacsysLinkUrl(samacsysLink?.href, "farnell");
  const farnellProductData = findFarnellProductData();
  const manufacturerName = linkMetadata?.manufacturerName || farnellProductData.manufacturerName;
  const manufacturerPartNumber =
    linkMetadata?.manufacturerPartNumber || farnellProductData.manufacturerPartNumber;
  const sourcePartNumber = farnellProductData.sourcePartNumber;
  const entryUrl = buildSamacsysEntryUrl({
    baseUrl: linkMetadata?.baseUrl || FARNELL_ENTRY_ORIGIN,
    manufacturerName,
    manufacturerPartNumber,
    partnerName: linkMetadata?.partnerName || "farnell",
    logo: linkMetadata?.logo,
    lang: linkMetadata?.lang
  });

  if (!sourcePartNumber || !manufacturerPartNumber || !entryUrl) {
    return null;
  }

  return {
    provider: FARNELL_PROVIDER,
    sourcePartLabel: FARNELL_SOURCE_LABEL,
    sourcePartNumber,
    manufacturerPartNumber,
    lookup: {
      manufacturerName,
      entryUrl,
      partnerName: linkMetadata?.partnerName || "farnell",
      samacsysBaseUrl: linkMetadata?.baseUrl || FARNELL_ENTRY_ORIGIN
    }
  };
}

function findEasyedaPartContext() {
  if (!isEasyedaHost()) {
    return null;
  }

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
    findFarnellPartContext() ||
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
