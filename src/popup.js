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
  chrome.runtime.sendMessage(
    { type: "GET_PREVIEW_SVGS", lcscId },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl);
        setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl);
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
    }
  );
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
      setStatus("Failed to save settings.", true);
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
    setStatus("No LCSC part number found on this page.", true);
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
      setStatus("Open a JLCPCB or LCSC product page.", true);
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
    setStatus("No active tab detected.", true);
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
downloadIndividuallyEl.addEventListener("change", saveSettings);

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
        model3d: downloadModelEl.checked,
        downloadIndividually: downloadIndividuallyEl.checked
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
