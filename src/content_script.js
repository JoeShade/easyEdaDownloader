function normalizeLabel(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractLcscId(text) {
  if (!text) {
    return null;
  }
  const match = text.toUpperCase().match(/C\d{3,}/);
  return match ? match[0] : null;
}

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

function findLcscId() {
  return findInDefinitionLists() || findInTables() || extractLcscId(document.body.textContent);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LCSC_ID") {
    return false;
  }

  const lcscId = findLcscId();
  sendResponse({ lcscId });
  return true;
});
