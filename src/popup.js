/*
 * This script powers the extension popup UI. It fetches the provider-aware
 * part context from the active tab, lets the user choose what to download, and
 * sends a request to the background service worker to start the export.
 */

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";
const DEFAULT_SOURCE_PART_LABEL = "Part";

// Cache UI elements for quick updates.
const manufacturerPartNumberEl = document.getElementById("manufacturerPartNumber");
const sourcePartLabelEl = document.getElementById("sourcePartLabel");
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
const libraryDownloadRootEl = document.getElementById("libraryDownloadRoot");
const resetLibraryDownloadRootEl = document.getElementById("resetLibraryDownloadRoot");
const symbolPreviewEl = document.getElementById("symbolPreview");
const footprintPreviewEl = document.getElementById("footprintPreview");
const symbolPreviewFallbackEl = document.getElementById("symbolPreviewFallback");
const footprintPreviewFallbackEl = document.getElementById("footprintPreviewFallback");

// Default settings for download organization.
const DEFAULT_LIBRARY_DOWNLOAD_ROOT = "easyEDADownloader";
const DEFAULT_SETTINGS = {
  downloadIndividually: false,
  libraryDownloadRoot: DEFAULT_LIBRARY_DOWNLOAD_ROOT
};

// Store the most recently detected part context.
let currentPartContext = null;

// Show a status message and optionally mark it as an error.
function setStatus(message, tone = "default") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", tone === "error");
  statusEl.classList.toggle("warning", tone === "warning");
}

function isFirefoxRuntime() {
  return /firefox/i.test(String(window.navigator?.userAgent || ""));
}

function isBlockedProvider(partContext = currentPartContext) {
  return partContext?.provider === MOUSER_PROVIDER && isFirefoxRuntime();
}

function hasSupportedPartContext() {
  return Boolean(currentPartContext?.provider);
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

// Enable the download button only when there is a supported provider and a selection.
function updateDownloadEnabled() {
  downloadButton.disabled =
    !hasSupportedPartContext() || isBlockedProvider() || !hasSelection();
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

function getPreviewDefaultDatasheetAvailability(partContext) {
  return partContext?.provider === MOUSER_PROVIDER ? false : null;
}

function setIdentifierDisplay(sourcePartLabel, sourcePartNumber, manufacturerPartNumber) {
  sourcePartLabelEl.textContent = sourcePartLabel || DEFAULT_SOURCE_PART_LABEL;
  manufacturerPartNumberEl.textContent = manufacturerPartNumber || "Not found";
  partNumberEl.textContent = sourcePartNumber || "Not found";
}

function setUnavailableDisplay(statusMessage) {
  currentPartContext = null;
  sourcePartLabelEl.textContent = DEFAULT_SOURCE_PART_LABEL;
  manufacturerPartNumberEl.textContent = "Unavailable";
  partNumberEl.textContent = "Unavailable";
  downloadButton.disabled = true;
  setStatus(statusMessage, "error");
  setDatasheetAvailability(false);
  setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Unavailable");
  setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Unavailable");
}

function requestPreviews(partContext) {
  const fallbackDatasheetAvailability =
    getPreviewDefaultDatasheetAvailability(partContext);
  setPreviewLoading(symbolPreviewFallbackEl, symbolPreviewEl);
  setPreviewLoading(footprintPreviewFallbackEl, footprintPreviewEl);
  setDatasheetAvailability(fallbackDatasheetAvailability);
  chrome.runtime.sendMessage(
    { type: "GET_PART_PREVIEWS", partContext },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl);
        setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl);
        setDatasheetAvailability(fallbackDatasheetAvailability);
        return;
      }
      setPreviewImage(
        symbolPreviewFallbackEl,
        symbolPreviewEl,
        response.previews?.symbolUrl || null
      );
      setPreviewImage(
        footprintPreviewFallbackEl,
        footprintPreviewEl,
        response.previews?.footprintUrl || null
      );
      setDatasheetAvailability(
        partContext?.provider === MOUSER_PROVIDER
          ? false
          : response.metadata?.datasheetAvailable === true
      );
    }
  );
}

// Normalize the library-mode download root so it stays relative to Downloads.
function normalizeLibraryDownloadRoot(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }
  if (
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    raw.startsWith("\\\\") ||
    /^[a-zA-Z]:/.test(raw)
  ) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  const normalized = raw.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  return {
    value: normalized,
    isValid: true
  };
}

// Apply settings values to the UI controls.
function applySettingsToUi(settings) {
  const normalizedRoot = normalizeLibraryDownloadRoot(settings.libraryDownloadRoot);
  downloadIndividuallyEl.checked =
    typeof settings.downloadIndividually === "boolean"
      ? settings.downloadIndividually
      : DEFAULT_SETTINGS.downloadIndividually;
  libraryDownloadRootEl.value = normalizedRoot.value;
}

// Read settings from the UI and normalize them.
function readSettingsFromUi() {
  const normalizedRoot = normalizeLibraryDownloadRoot(libraryDownloadRootEl.value);
  libraryDownloadRootEl.value = normalizedRoot.value;
  return {
    downloadIndividually: Boolean(downloadIndividuallyEl.checked),
    libraryDownloadRoot: normalizedRoot.value,
    libraryDownloadRootIsValid: normalizedRoot.isValid
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
  const { libraryDownloadRootIsValid, ...storedSettings } = settings;
  chrome.storage.local.set(storedSettings, () => {
    if (chrome.runtime.lastError) {
      setStatus("Failed to save settings.", "error");
      return;
    }
    if (!libraryDownloadRootIsValid) {
      setStatus(
        "Download folder must stay inside Downloads. Reset to the default library folder.",
        "warning"
      );
    }
  });
}

// Update UI state based on whether a supported provider was found.
function setPartContext(partContext) {
  currentPartContext = partContext?.provider ? partContext : null;

  if (!currentPartContext) {
    setIdentifierDisplay(DEFAULT_SOURCE_PART_LABEL, null, null);
    downloadButton.disabled = true;
    setStatus("No supported part found on this page.", "error");
    setDatasheetAvailability(false);
    setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Not found");
    setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Not found");
    return;
  }

  setIdentifierDisplay(
    currentPartContext.sourcePartLabel,
    currentPartContext.sourcePartNumber,
    currentPartContext.manufacturerPartNumber
  );

  if (isBlockedProvider(currentPartContext)) {
    setStatus(
      "Mouser/SamacSys downloads require a proxy in Firefox. Chrome-only for now.",
      "error"
    );
    setDatasheetAvailability(false);
    setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Unavailable");
    setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Unavailable");
    updateDownloadEnabled();
    return;
  }

  updateDownloadEnabled();
  setStatus("");
  requestPreviews(currentPartContext);
}

// Ask the content script in the active tab for the provider-aware part context.
function requestPartContextFromTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "GET_PART_CONTEXT" }, (response) => {
    if (chrome.runtime.lastError) {
      setUnavailableDisplay("Open a supported product page.");
      return;
    }
    setPartContext(response || null);
  });
}

// On popup open, query the active tab and request the current part context.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    setUnavailableDisplay("No active tab detected.");
    return;
  }
  requestPartContextFromTab(tab.id);
});

// Load settings when the popup opens.
loadSettings();

// Keep button state in sync with checkbox changes.
downloadSymbolEl.addEventListener("change", updateDownloadEnabled);
downloadFootprintEl.addEventListener("change", updateDownloadEnabled);
downloadModelEl.addEventListener("change", updateDownloadEnabled);
downloadDatasheetEl.addEventListener("change", updateDownloadEnabled);
downloadIndividuallyEl.addEventListener("change", saveSettings);
libraryDownloadRootEl.addEventListener("change", saveSettings);
resetLibraryDownloadRootEl.addEventListener("click", () => {
  libraryDownloadRootEl.value = DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  saveSettings();
});

// When clicked, validate selections and ask the background worker to export.
downloadButton.addEventListener("click", () => {
  if (!hasSupportedPartContext() || isBlockedProvider()) {
    return;
  }

  if (!hasSelection()) {
    setStatus("Select at least one download option.", "error");
    return;
  }

  downloadButton.disabled = true;
  setStatus("Starting download...");

  chrome.runtime.sendMessage(
    {
      type: "EXPORT_PART",
      partContext: currentPartContext,
      options: {
        symbol: downloadSymbolEl.checked,
        footprint: downloadFootprintEl.checked,
        model3d: downloadModelEl.checked,
        datasheet: downloadDatasheetEl.checked
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
