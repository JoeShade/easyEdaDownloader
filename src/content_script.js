/*
 * This content script runs in JLCPCB/LCSC pages and tries to
 * locate the LCSC part number by scanning common page layouts. It looks in
 * definition lists and table rows first, then falls back to a full-page scan.
 */

// Normalize a label so we can compare it reliably.
function normalizeLabel(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Pull the LCSC part id (e.g., C12345) out of a text string.
function extractLcscId(text) {
  if (!text) {
    return null;
  }
  const match = text.toUpperCase().match(/C\d{3,}/);
  return match ? match[0] : null;
}

// Search definition list entries (<dl><dt><dd>) for the part number.
function findInDefinitionLists() {
  const lists = document.querySelectorAll("dl");
  for (const list of lists) {
    const dt = list.querySelector("dt");
    const dd = list.querySelector("dd");
    if (!dt || !dd) {
      continue;
    }
    const label = normalizeLabel(dt.textContent || "");
    if (label.includes("jlcpcb part #") || label.includes("lcsc part #")) {
      const lcscId = extractLcscId(dd.textContent);
      if (lcscId) {
        return lcscId;
      }
    }
  }
  return null;
}

// Search the common product table layout for the part number.
function findInTables() {
  const rows = document.querySelectorAll("table.tableInfoWrap tr");
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) {
      continue;
    }
    const label = normalizeLabel(cells[0].textContent || "");
    if (label.includes("lcsc part #")) {
      const lcscId = extractLcscId(cells[1].textContent);
      if (lcscId) {
        return lcscId;
      }
    }
  }
  return null;
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
  sendResponse({ lcscId });
  return true;
});
/*
 * This file is part of easyEdaDownloader.
 *
 * easyEdaDownloader is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This software is derived from easyeda2kicad.py by uPesy.
 */
