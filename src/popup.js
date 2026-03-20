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
const downloadDatasheetEl = document.getElementById("downloadDatasheet");
const downloadDatasheetOptionEl = document.getElementById("downloadDatasheetOption");
const downloadDatasheetLabelEl = document.getElementById("downloadDatasheetLabel");
const downloadIndividuallyEl = document.getElementById("downloadIndividually");
const symbolPreviewEl = document.getElementById("symbolPreview");
const footprintPreviewEl = document.getElementById("footprintPreview");
const symbolPreviewFallbackEl = document.getElementById("symbolPreviewFallback");
const footprintPreviewFallbackEl = document.getElementById("footprintPreviewFallback");

// Default settings for download organization.
const DEFAULT_SETTINGS = {
  downloadIndividually: false
};

// Store the most recently detected LCSC id.
let currentLcscId = null;

// Show a status message and optionally mark it as an error.
function setStatus(message, tone = "default") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", tone === "error");
  statusEl.classList.toggle("warning", tone === "warning");
}

// Determine if the user selected any download option.
function hasSelection() {
  return (
    downloadSymbolEl.checked ||
    downloadFootprintEl.checked ||
    downloadModelEl.checked ||
    downloadDatasheetEl.checked
  );
}

// Enable the download button only when there is a part id and a selection.
function updateDownloadEnabled() {
  downloadButton.disabled = !currentLcscId || !hasSelection();
}

function setPreviewLoading(fallbackEl, imgEl) {
  fallbackEl.textContent = "Loading...";
  fallbackEl.classList.remove("hidden");
  imgEl.classList.add("hidden");
  imgEl.removeAttribute("src");
}

function setPreviewUnavailable(fallbackEl, imgEl, message = "Not available") {
  fallbackEl.textContent = message;
  fallbackEl.classList.remove("hidden");
  imgEl.classList.add("hidden");
  imgEl.removeAttribute("src");
}

function setPreviewImage(fallbackEl, imgEl, url) {
  if (!url) {
    setPreviewUnavailable(fallbackEl, imgEl);
    return;
  }
  fallbackEl.textContent = "Loading...";
  fallbackEl.classList.remove("hidden");
  imgEl.classList.remove("hidden");
  imgEl.onload = () => {
    fallbackEl.classList.add("hidden");
  };
  imgEl.onerror = () => {
    setPreviewUnavailable(fallbackEl, imgEl);
  };
  imgEl.src = url;
}

function requestPreviews(lcscId) {
  setPreviewLoading(symbolPreviewFallbackEl, symbolPreviewEl);
  setPreviewLoading(footprintPreviewFallbackEl, footprintPreviewEl);
  setDatasheetAvailability(null);
  chrome.runtime.sendMessage(
    { type: "GET_PREVIEW_SVGS", lcscId },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl);
        setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl);
        setDatasheetAvailability(null);
        return;
      }
      const symbolSvg = response.previews?.symbolSvg;
      const footprintSvg = response.previews?.footprintSvg;
      const symbolUrl = symbolSvg
        ? `data:image/svg+xml;utf8,${encodeURIComponent(symbolSvg)}`
        : null;
      const footprintUrl = footprintSvg
        ? `data:image/svg+xml;utf8,${encodeURIComponent(footprintSvg)}`
        : null;
      setPreviewImage(symbolPreviewFallbackEl, symbolPreviewEl, symbolUrl);
      setPreviewImage(
        footprintPreviewFallbackEl,
        footprintPreviewEl,
        footprintUrl
      );
      setDatasheetAvailability(response.metadata?.datasheetAvailable === true);
    }
  );
}

function setDatasheetAvailability(isAvailable) {
  if (isAvailable === false) {
    downloadDatasheetEl.checked = false;
    downloadDatasheetEl.disabled = true;
    downloadDatasheetOptionEl.classList.add("disabled");
    downloadDatasheetLabelEl.textContent = "Datasheet (not available)";
    updateDownloadEnabled();
    return;
  }

  downloadDatasheetEl.disabled = false;
  downloadDatasheetOptionEl.classList.remove("disabled");
  downloadDatasheetLabelEl.textContent = "Datasheet";
  updateDownloadEnabled();
}

// Apply settings values to the UI controls.
function applySettingsToUi(settings) {
  downloadIndividuallyEl.checked =
    typeof settings.downloadIndividually === "boolean"
      ? settings.downloadIndividually
      : DEFAULT_SETTINGS.downloadIndividually;
}

// Read settings from the UI and normalize them.
function readSettingsFromUi() {
  return {
    downloadIndividually: Boolean(downloadIndividuallyEl.checked)
  };
}

// Load settings from extension storage.
function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
    if (chrome.runtime.lastError) {
      console.warn("Failed to load settings:", chrome.runtime.lastError);
      applySettingsToUi(DEFAULT_SETTINGS);
      return;
    }
    applySettingsToUi(settings);
  });
}

// Save settings to extension storage.
function saveSettings() {
  const settings = readSettingsFromUi();
  chrome.storage.local.set(settings, () => {
    if (chrome.runtime.lastError) {
      setStatus("Failed to save settings.", "error");
    }
  });
}

// Update UI state based on whether a part number was found.
function setPartNumber(lcscId) {
  currentLcscId = lcscId;
  if (lcscId) {
    partNumberEl.textContent = lcscId;
    updateDownloadEnabled();
    setStatus("");
    requestPreviews(lcscId);
  } else {
    partNumberEl.textContent = "Not found";
    downloadButton.disabled = true;
    setStatus("No LCSC part number found on this page.", "error");
    setDatasheetAvailability(false);
    setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Not found");
    setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Not found");
  }
}

// Ask the content script in the active tab for the LCSC id.
function requestLcscIdFromTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "GET_LCSC_ID" }, (response) => {
    if (chrome.runtime.lastError) {
      partNumberEl.textContent = "Unavailable";
      downloadButton.disabled = true;
      setStatus("Open a JLCPCB or LCSC product page.", "error");
      setDatasheetAvailability(false);
      setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Unavailable");
      setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Unavailable");
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
    setStatus("No active tab detected.", "error");
    return;
  }
  requestLcscIdFromTab(tab.id);
});

// Load settings when the popup opens.
loadSettings();

// Keep button state in sync with checkbox changes.
downloadSymbolEl.addEventListener("change", updateDownloadEnabled);
downloadFootprintEl.addEventListener("change", updateDownloadEnabled);
downloadModelEl.addEventListener("change", updateDownloadEnabled);
downloadDatasheetEl.addEventListener("change", updateDownloadEnabled);
downloadIndividuallyEl.addEventListener("change", saveSettings);

// When clicked, validate selections and ask the background worker to export.
downloadButton.addEventListener("click", () => {
  if (!currentLcscId) {
    return;
  }

  if (!hasSelection()) {
    setStatus("Select at least one download option.", "error");
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
        model3d: downloadModelEl.checked,
        datasheet: downloadDatasheetEl.checked,
        downloadIndividually: downloadIndividuallyEl.checked
      }
    },
    (response) => {
      updateDownloadEnabled();
      if (chrome.runtime.lastError) {
        setStatus("Download failed. Check the console.", "error");
        return;
      }
      if (response?.ok) {
        const warnings = Array.isArray(response.warnings)
          ? response.warnings.filter(Boolean)
          : [];
        if (warnings.length && response.downloadCount > 0) {
          setStatus(`Download started. ${warnings.join(" ")}`, "warning");
        } else if (warnings.length) {
          setStatus(warnings.join(" "), "warning");
        } else {
          setStatus("Download started.");
        }
      } else {
        setStatus(response?.error || "Download failed.", "error");
      }
    }
  );
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
