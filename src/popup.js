const partNumberEl = document.getElementById("partNumber");
const downloadButton = document.getElementById("downloadButton");
const statusEl = document.getElementById("status");
const downloadSymbolEl = document.getElementById("downloadSymbol");
const downloadFootprintEl = document.getElementById("downloadFootprint");
const downloadModelEl = document.getElementById("downloadModel");

let currentLcscId = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function hasSelection() {
  return (
    downloadSymbolEl.checked ||
    downloadFootprintEl.checked ||
    downloadModelEl.checked
  );
}

function updateDownloadEnabled() {
  downloadButton.disabled = !currentLcscId || !hasSelection();
}

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

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    partNumberEl.textContent = "Unavailable";
    setStatus("No active tab detected.", true);
    return;
  }
  requestLcscIdFromTab(tab.id);
});

downloadSymbolEl.addEventListener("change", updateDownloadEnabled);
downloadFootprintEl.addEventListener("change", updateDownloadEnabled);
downloadModelEl.addEventListener("change", updateDownloadEnabled);

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
