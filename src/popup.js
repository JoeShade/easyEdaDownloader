/*
 * This script powers the extension popup UI. It fetches the LCSC
 * part number from the active tab, lets the user choose what to download, and
 * sends a request to the background service worker to start the export.
 */

// Cache UI elements for quick updates.
const partNumberEl = document.getElementById("partNumber");
const downloadButton = document.getElementById("downloadButton");
const statusEl = document.getElementById("status");
const downloadSymbolEl = document.getElementById("downloadSymbol");
const downloadFootprintEl = document.getElementById("downloadFootprint");
const downloadModelEl = document.getElementById("downloadModel");

// Store the most recently detected LCSC id.
let currentLcscId = null;

// Show a status message and optionally mark it as an error.
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

// Determine if the user selected any download option.
function hasSelection() {
  return (
    downloadSymbolEl.checked ||
    downloadFootprintEl.checked ||
    downloadModelEl.checked
  );
}

// Enable the download button only when there is a part id and a selection.
function updateDownloadEnabled() {
  downloadButton.disabled = !currentLcscId || !hasSelection();
}

// Update UI state based on whether a part number was found.
function setPartNumber(lcscId) {
  currentLcscId = lcscId;
  if (lcscId) {
    partNumberEl.textContent = lcscId;
    updateDownloadEnabled();
    setStatus("");
  } else {
    partNumberEl.textContent = "Not found";
    downloadButton.disabled = true;
    setStatus("No LCSC part number found on this page.", true);
  }
}

// Ask the content script in the active tab for the LCSC id.
function requestLcscIdFromTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "GET_LCSC_ID" }, (response) => {
    if (chrome.runtime.lastError) {
      partNumberEl.textContent = "Unavailable";
      downloadButton.disabled = true;
      setStatus("Open a JLCPCB or LCSC product page.", true);
      return;
    }
    setPartNumber(response?.lcscId || null);
  });
}

// On popup open, query the active tab and request the LCSC id.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    partNumberEl.textContent = "Unavailable";
    setStatus("No active tab detected.", true);
    return;
  }
  requestLcscIdFromTab(tab.id);
});

// Keep button state in sync with checkbox changes.
downloadSymbolEl.addEventListener("change", updateDownloadEnabled);
downloadFootprintEl.addEventListener("change", updateDownloadEnabled);
downloadModelEl.addEventListener("change", updateDownloadEnabled);

// When clicked, validate selections and ask the background worker to export.
downloadButton.addEventListener("click", () => {
  if (!currentLcscId) {
    return;
  }

  if (!hasSelection()) {
    setStatus("Select at least one download option.", true);
    return;
  }

  downloadButton.disabled = true;
  setStatus("Starting download...");

  // Send request to service worker with chosen export options.
  chrome.runtime.sendMessage(
    {
      type: "EXPORT_PART",
      lcscId: currentLcscId,
      options: {
        symbol: downloadSymbolEl.checked,
        footprint: downloadFootprintEl.checked,
        model3d: downloadModelEl.checked
      }
    },
    (response) => {
      updateDownloadEnabled();
      if (chrome.runtime.lastError) {
        setStatus("Download failed. Check the console.", true);
        return;
      }
      if (response?.ok) {
        setStatus("Download started.");
      } else {
        setStatus(response?.error || "Download failed.", true);
      }
    }
  );
});
