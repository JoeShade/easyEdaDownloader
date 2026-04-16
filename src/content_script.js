/*
 * This content script inspects supported product pages and returns a provider-
 * aware part context for the popup. EasyEDA/LCSC pages expose an LCSC part id,
 * while SamacSys distributor pages expose lookup metadata through page-specific
 * ECAD entry points.
 */

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";
const FARNELL_PROVIDER = "farnellSamacsys";
const EASYEDA_SOURCE_LABEL = "LCSC part";
const DISTRIBUTORS = {
  mouser: {
    provider: MOUSER_PROVIDER,
    sourcePartLabel: "Mouser part",
    baseUrl: "https://ms.componentsearchengine.com"
  },
  farnell: {
    provider: FARNELL_PROVIDER,
    sourcePartLabel: "Farnell part",
    baseUrl: "https://farnell.componentsearchengine.com"
  }
};
const EMPTY_PART_CONTEXT = {
  provider: null,
  sourcePartLabel: null,
  sourcePartNumber: null,
  manufacturerPartNumber: null,
  lookup: null
};
const SAMACSYS_DOWNLOAD_TRIGGER_TEXT = "download cad models";
const SAMACSYS_DOWNLOAD_TRIGGER_TIMEOUT_MS = 5000;
let scheduledSamacsysDownloadObserver = null;
let scheduledSamacsysDownloadTimeoutId = null;

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

function hasExpectedLabel(label, expectedLabels, exact = false) {
  if (exact) {
    return expectedLabels.includes(label);
  }
  return matchesKnownLabel(label, expectedLabels);
}

function findLabeledTextInPairs(pairs, expectedLabels, exact = false) {
  const normalizedExpectedLabels = expectedLabels.map((label) => normalizeLabel(label));
  for (const [labelNode, valueNode] of pairs) {
    if (!labelNode || !valueNode) {
      continue;
    }
    const label = normalizeLabel(labelNode.textContent || "");
    if (hasExpectedLabel(label, normalizedExpectedLabels, exact)) {
      return normalizeDetectedValue(valueNode.textContent);
    }
  }
  return null;
}

function findDefinitionListText(expectedLabels, exact = false) {
  return findLabeledTextInPairs(
    Array.from(document.querySelectorAll("dl"), (list) => [
      list.querySelector("dt"),
      list.querySelector("dd")
    ]),
    expectedLabels,
    exact
  );
}

function findTableText(expectedLabels, exact = false) {
  return findLabeledTextInPairs(
    Array.from(document.querySelectorAll("table.tableInfoWrap tr"), (row) => {
      const cells = row.querySelectorAll("td");
      return [cells[0], cells[1]];
    }),
    expectedLabels,
    exact
  );
}

function findLabeledText(expectedLabels, exact = false) {
  return (
    findDefinitionListText(expectedLabels, exact) ||
    findTableText(expectedLabels, exact)
  );
}

function findManufacturerPartNumber() {
  return extractManufacturerPartNumber(findLabeledText(["mfr. part #"]));
}

// Try the targeted searches first, then scan the entire page as a fallback.
function findLcscId() {
  return (
    extractLcscId(findLabeledText(["jlcpcb part #", "lcsc part #"])) ||
    extractLcscId(document.body.textContent)
  );
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
      findLabeledText(["Manufacturer"], true) ||
      pathData?.manufacturerName ||
      null,
    manufacturerPartNumber:
      descriptionData?.manufacturerPartNumber ||
      imageAltData?.manufacturerPartNumber ||
      findLabeledText(["Manufacturer Part No", "Mfr. Part #"], true) ||
      pathData?.manufacturerPartNumber ||
      null,
    sourcePartNumber:
      findLabeledText(["Order Code", "Farnell Part No", "Farnell No"], true) ||
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
  baseUrl = DISTRIBUTORS.mouser.baseUrl,
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

function buildSamacsysPartContext({
  distributor,
  sourcePartNumber,
  manufacturerPartNumber,
  manufacturerName,
  baseUrl,
  authRefreshUrl,
  logo,
  lang
}) {
  const config = DISTRIBUTORS[distributor];
  const entryUrl = buildSamacsysEntryUrl({
    baseUrl: baseUrl || config.baseUrl,
    manufacturerName,
    manufacturerPartNumber,
    partnerName: distributor,
    logo,
    lang
  });
  if (!sourcePartNumber || !manufacturerPartNumber || !entryUrl) {
    return null;
  }

  return {
    provider: config.provider,
    sourcePartLabel: config.sourcePartLabel,
    sourcePartNumber,
    manufacturerPartNumber,
    lookup: {
      manufacturerName,
      entryUrl,
      ...(authRefreshUrl ? { authRefreshUrl } : {}),
      partnerName: distributor,
      samacsysBaseUrl: baseUrl || config.baseUrl
    }
  };
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
  return buildSamacsysPartContext({
    distributor: "mouser",
    sourcePartNumber,
    manufacturerPartNumber,
    manufacturerName,
    baseUrl: DISTRIBUTORS.mouser.baseUrl,
    logo: loadPartDivData?.logo,
    lang: loadPartDivData?.lang
  });
}

function findFarnellPartContext() {
  const samacsysLink = findSamacsysLinkElement();
  const linkMetadata = parseSamacsysLinkUrl(samacsysLink?.href, "farnell");
  const farnellProductData = findFarnellProductData();
  const manufacturerName = linkMetadata?.manufacturerName || farnellProductData.manufacturerName;
  const manufacturerPartNumber =
    linkMetadata?.manufacturerPartNumber || farnellProductData.manufacturerPartNumber;
  return buildSamacsysPartContext({
    distributor: "farnell",
    sourcePartNumber: farnellProductData.sourcePartNumber,
    manufacturerPartNumber,
    manufacturerName,
    baseUrl: linkMetadata?.baseUrl || DISTRIBUTORS.farnell.baseUrl,
    authRefreshUrl: linkMetadata ? samacsysLink.href : null,
    logo: linkMetadata?.logo,
    lang: linkMetadata?.lang
  });
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
    findEasyedaPartContext() ||
    EMPTY_PART_CONTEXT
  );
}

function findSamacsysAuthTriggerElement(provider = findPartContext()?.provider) {
  if (provider === MOUSER_PROVIDER) {
    return document.querySelector('#lnk_CadModel[data-testid="ProductInfoECAD"]');
  }
  if (provider === FARNELL_PROVIDER) {
    return findSamacsysLinkElement();
  }
  return null;
}

function clearScheduledSamacsysDownloadClick() {
  scheduledSamacsysDownloadObserver?.disconnect();
  scheduledSamacsysDownloadObserver = null;
  if (scheduledSamacsysDownloadTimeoutId !== null) {
    window.clearTimeout(scheduledSamacsysDownloadTimeoutId);
    scheduledSamacsysDownloadTimeoutId = null;
  }
}

function readSamacsysTriggerLabel(element) {
  if (!element) {
    return "";
  }
  if (element instanceof window.HTMLInputElement) {
    return normalizeDetectedValue(element.value) || "";
  }
  return (
    normalizeDetectedValue(element.textContent) ||
    normalizeDetectedValue(element.getAttribute("aria-label")) ||
    normalizeDetectedValue(element.getAttribute("title")) ||
    ""
  );
}

function findDownloadCadModelsElement(root = document) {
  const candidates = root.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"]'
  );
  return Array.from(candidates).find((element) =>
    normalizeLabel(readSamacsysTriggerLabel(element)).includes(
      SAMACSYS_DOWNLOAD_TRIGGER_TEXT
    )
  ) || null;
}

function scheduleSamacsysDownloadCadModelsClick(
  timeoutMs = SAMACSYS_DOWNLOAD_TRIGGER_TIMEOUT_MS
) {
  clearScheduledSamacsysDownloadClick();

  const tryClick = () => {
    const downloadTrigger = findDownloadCadModelsElement();
    if (!downloadTrigger) {
      return false;
    }
    downloadTrigger.click();
    clearScheduledSamacsysDownloadClick();
    return true;
  };

  if (tryClick() || !document.body) {
    return;
  }

  const MutationObserverConstructor = window.MutationObserver;
  if (!MutationObserverConstructor) {
    return;
  }

  scheduledSamacsysDownloadObserver = new MutationObserverConstructor(() => {
    tryClick();
  });
  scheduledSamacsysDownloadObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });
  scheduledSamacsysDownloadTimeoutId = window.setTimeout(() => {
    clearScheduledSamacsysDownloadClick();
  }, timeoutMs);
}

function triggerSamacsysAuthFrame(url) {
  if (!url) {
    return false;
  }

  const existingFrame = document.getElementById("easyeda-samacsys-auth-frame");
  existingFrame?.remove();

  const authFrame = document.createElement("iframe");
  authFrame.id = "easyeda-samacsys-auth-frame";
  authFrame.src = url;
  authFrame.setAttribute("aria-hidden", "true");
  authFrame.style.position = "fixed";
  authFrame.style.width = "1px";
  authFrame.style.height = "1px";
  authFrame.style.opacity = "0";
  authFrame.style.pointerEvents = "none";
  authFrame.style.border = "0";
  authFrame.style.left = "-9999px";
  authFrame.style.bottom = "0";
  document.body.appendChild(authFrame);
  return true;
}

function triggerSamacsysAuth(partContext = findPartContext()) {
  const triggerElement = findSamacsysAuthTriggerElement(partContext?.provider);
  if (!triggerElement) {
    const fallbackUrl =
      partContext?.lookup?.authRefreshUrl || partContext?.lookup?.entryUrl || "";
    if (triggerSamacsysAuthFrame(fallbackUrl)) {
      scheduleSamacsysDownloadCadModelsClick();
      return { ok: true };
    }
    return {
      ok: false,
      error: "SamacSys auth trigger was not found on the current page."
    };
  }

  triggerElement.click();
  scheduleSamacsysDownloadCadModelsClick();
  return { ok: true };
}

// Listen for extension messages and reply with the detected part context.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PART_CONTEXT") {
    sendResponse(findPartContext());
    return true;
  }

  if (message?.type === "TRIGGER_SAMACSYS_AUTH") {
    sendResponse(triggerSamacsysAuth(message.partContext));
    return true;
  }

  return false;
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
