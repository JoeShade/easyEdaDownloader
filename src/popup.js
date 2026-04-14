/*
 * This script powers the extension popup UI. It fetches the provider-aware
 * part context from the active tab, lets the user choose what to download, and
 * sends a request to the background service worker to start the export while
 * reusing the shared provider and settings helpers from src/core.
 */

import {
  DEFAULT_LIBRARY_DOWNLOAD_ROOT,
  DEFAULT_SETTINGS,
  loadSettings as loadStoredSettings,
  parseLibraryDownloadRoot,
  parseSamacsysCredentialValue,
  parseSamacsysAuthorizationHeader,
  parseSamacsysProxyAuthorizationHeader,
  parseSamacsysFirefoxProxyBaseUrl
} from "./core/settings.js";
import {
  getBlockedPartContextError,
  isBlockedPartContext,
  isSamacsysProvider as isSamacsysProviderShared
} from "./core/part_context.js";

const DEFAULT_SOURCE_PART_LABEL = "Part";
const chromeApi = globalThis.chrome;
const popupWindow = globalThis.window;
const popupDocument = globalThis.document;

// Cache UI elements for quick updates.
const manufacturerPartNumberEl = popupDocument.getElementById("manufacturerPartNumber");
const sourcePartLabelEl = popupDocument.getElementById("sourcePartLabel");
const partNumberEl = popupDocument.getElementById("partNumber");
const downloadButton = popupDocument.getElementById("downloadButton");
const statusEl = popupDocument.getElementById("status");
const downloadSymbolEl = popupDocument.getElementById("downloadSymbol");
const downloadFootprintEl = popupDocument.getElementById("downloadFootprint");
const downloadModelEl = popupDocument.getElementById("downloadModel");
const downloadDatasheetEl = popupDocument.getElementById("downloadDatasheet");
const downloadDatasheetOptionEl = popupDocument.getElementById("downloadDatasheetOption");
const downloadDatasheetLabelEl = popupDocument.getElementById("downloadDatasheetLabel");
const downloadIndividuallyEl = popupDocument.getElementById("downloadIndividually");
const libraryDownloadRootEl = popupDocument.getElementById("libraryDownloadRoot");
const resetLibraryDownloadRootEl = popupDocument.getElementById("resetLibraryDownloadRoot");
const samacsysFirefoxProxyBaseUrlEl = popupDocument.getElementById(
  "samacsysFirefoxProxyBaseUrl"
);
const samacsysFirefoxProxyAuthorizationHeaderEl = popupDocument.getElementById(
  "samacsysFirefoxProxyAuthorizationHeader"
);
const samacsysFirefoxUsernameEl = popupDocument.getElementById(
  "samacsysFirefoxUsername"
);
const samacsysFirefoxPasswordEl = popupDocument.getElementById(
  "samacsysFirefoxPassword"
);
const samacsysFirefoxCapturedAuthorizationStatusEl = popupDocument.getElementById(
  "samacsysFirefoxCapturedAuthorizationStatus"
);
const samacsysFirefoxAuthorizationHeaderEl = popupDocument.getElementById(
  "samacsysFirefoxAuthorizationHeader"
);
const symbolPreviewEl = popupDocument.getElementById("symbolPreview");
const footprintPreviewEl = popupDocument.getElementById("footprintPreview");
const symbolPreviewFallbackEl = popupDocument.getElementById("symbolPreviewFallback");
const footprintPreviewFallbackEl = popupDocument.getElementById("footprintPreviewFallback");

// Store the most recently detected part context.
let currentPartContext = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let currentSourceTabId = null;

// Show a status message and optionally mark it as an error.
function setStatus(message, tone = "default") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", tone === "error");
  statusEl.classList.toggle("warning", tone === "warning");
}

function isBlockedProvider(partContext = currentPartContext) {
  return isBlockedPartContext(
    partContext,
    popupWindow.navigator?.userAgent,
    currentSettings.samacsysFirefoxProxyBaseUrl
  );
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
    !currentPartContext?.provider || isBlockedProvider() || !hasSelection();
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
  return isSamacsysProviderShared(partContext?.provider) ? false : null;
}

function formatCapturedAuthorizationStatus(
  capturedAuthorizationHeader,
  capturedAuthorizationCapturedAt
) {
  if (!capturedAuthorizationHeader) {
    return "No captured SamacSys auth header yet.";
  }

  if (!capturedAuthorizationCapturedAt) {
    return "Captured SamacSys auth header available.";
  }

  const capturedDate = new Date(capturedAuthorizationCapturedAt);
  if (Number.isNaN(capturedDate.getTime())) {
    return "Captured SamacSys auth header available.";
  }

  return `Captured SamacSys auth header available from ${capturedDate.toLocaleString()}.`;
}

function refreshSamacsysAuthStatus() {
  samacsysFirefoxCapturedAuthorizationStatusEl.textContent =
    formatCapturedAuthorizationStatus(
      currentSettings.samacsysFirefoxCapturedAuthorizationHeader,
      currentSettings.samacsysFirefoxCapturedAuthorizationCapturedAt
    );
}

function setIdentifierDisplay(sourcePartLabel, sourcePartNumber, manufacturerPartNumber) {
  sourcePartLabelEl.textContent = sourcePartLabel || DEFAULT_SOURCE_PART_LABEL;
  manufacturerPartNumberEl.textContent = manufacturerPartNumber || "Not found";
  partNumberEl.textContent = sourcePartNumber || "Not found";
}

function setUnavailableDisplay(statusMessage) {
  currentPartContext = null;
  currentSourceTabId = null;
  sourcePartLabelEl.textContent = DEFAULT_SOURCE_PART_LABEL;
  manufacturerPartNumberEl.textContent = "Unavailable";
  partNumberEl.textContent = "Unavailable";
  downloadButton.disabled = true;
  setStatus(statusMessage, "error");
  setDatasheetAvailability(false);
  setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Unavailable");
  setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Unavailable");
  refreshSamacsysAuthStatus();
}

function requestPreviews(partContext) {
  const fallbackDatasheetAvailability =
    getPreviewDefaultDatasheetAvailability(partContext);
  setPreviewLoading(symbolPreviewFallbackEl, symbolPreviewEl);
  setPreviewLoading(footprintPreviewFallbackEl, footprintPreviewEl);
  setDatasheetAvailability(fallbackDatasheetAvailability);
  chromeApi.runtime.sendMessage(
    { type: "GET_PART_PREVIEWS", partContext },
    (response) => {
      if (chromeApi.runtime.lastError || !response?.ok) {
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
        isSamacsysProviderShared(partContext?.provider)
          ? false
          : response.metadata?.datasheetAvailable === true
      );
    }
  );
}

// Apply settings values to the UI controls.
function applySettingsToUi(settings) {
  const normalizedRoot = parseLibraryDownloadRoot(settings.libraryDownloadRoot);
  const normalizedProxy = parseSamacsysFirefoxProxyBaseUrl(
    settings.samacsysFirefoxProxyBaseUrl
  );
  const normalizedProxyAuthorizationHeader = parseSamacsysProxyAuthorizationHeader(
    settings.samacsysFirefoxProxyAuthorizationHeader
  );
  const normalizedUsername = parseSamacsysCredentialValue(
    settings.samacsysFirefoxUsername
  );
  const normalizedPassword = parseSamacsysCredentialValue(
    settings.samacsysFirefoxPassword
  );
  const normalizedAuthorizationHeader = parseSamacsysAuthorizationHeader(
    settings.samacsysFirefoxAuthorizationHeader
  );
  const capturedAuthorizationHeader = parseSamacsysAuthorizationHeader(
    settings.samacsysFirefoxCapturedAuthorizationHeader
  );
  downloadIndividuallyEl.checked =
    typeof settings.downloadIndividually === "boolean"
      ? settings.downloadIndividually
      : DEFAULT_SETTINGS.downloadIndividually;
  libraryDownloadRootEl.value = normalizedRoot.value;
  samacsysFirefoxProxyBaseUrlEl.value = normalizedProxy.value;
  samacsysFirefoxProxyAuthorizationHeaderEl.value =
    normalizedProxyAuthorizationHeader;
  samacsysFirefoxUsernameEl.value = normalizedUsername;
  samacsysFirefoxPasswordEl.value = normalizedPassword;
  samacsysFirefoxAuthorizationHeaderEl.value = normalizedAuthorizationHeader;
  currentSettings = {
    downloadIndividually: downloadIndividuallyEl.checked,
    libraryDownloadRoot: normalizedRoot.value,
    samacsysFirefoxProxyBaseUrl: normalizedProxy.value,
    samacsysFirefoxProxyAuthorizationHeader: normalizedProxyAuthorizationHeader,
    samacsysFirefoxUsername: normalizedUsername,
    samacsysFirefoxPassword: normalizedPassword,
    samacsysFirefoxAuthorizationHeader: normalizedAuthorizationHeader,
    samacsysFirefoxCapturedAuthorizationHeader: capturedAuthorizationHeader,
    samacsysFirefoxCapturedAuthorizationCapturedAt:
      settings.samacsysFirefoxCapturedAuthorizationCapturedAt || ""
  };
  refreshSamacsysAuthStatus();
  if (currentPartContext && isSamacsysProviderShared(currentPartContext.provider)) {
    setPartContext(currentPartContext);
  } else {
    updateDownloadEnabled();
  }
}

// Read settings from the UI and normalize them.
function readSettingsFromUi() {
  const normalizedRoot = parseLibraryDownloadRoot(libraryDownloadRootEl.value);
  const normalizedProxy = parseSamacsysFirefoxProxyBaseUrl(
    samacsysFirefoxProxyBaseUrlEl.value
  );
  const normalizedProxyAuthorizationHeader = parseSamacsysProxyAuthorizationHeader(
    samacsysFirefoxProxyAuthorizationHeaderEl.value
  );
  const normalizedUsername = parseSamacsysCredentialValue(
    samacsysFirefoxUsernameEl.value
  );
  const normalizedPassword = parseSamacsysCredentialValue(
    samacsysFirefoxPasswordEl.value
  );
  const normalizedAuthorizationHeader = parseSamacsysAuthorizationHeader(
    samacsysFirefoxAuthorizationHeaderEl.value
  );
  libraryDownloadRootEl.value = normalizedRoot.value;
  samacsysFirefoxProxyBaseUrlEl.value = normalizedProxy.value;
  samacsysFirefoxProxyAuthorizationHeaderEl.value =
    normalizedProxyAuthorizationHeader;
  samacsysFirefoxUsernameEl.value = normalizedUsername;
  samacsysFirefoxPasswordEl.value = normalizedPassword;
  samacsysFirefoxAuthorizationHeaderEl.value = normalizedAuthorizationHeader;
  return {
    downloadIndividually: Boolean(downloadIndividuallyEl.checked),
    libraryDownloadRoot: normalizedRoot.value,
    libraryDownloadRootIsValid: normalizedRoot.isValid,
    samacsysFirefoxProxyBaseUrl: normalizedProxy.value,
    samacsysFirefoxProxyBaseUrlIsValid: normalizedProxy.isValid,
    samacsysFirefoxProxyAuthorizationHeader: normalizedProxyAuthorizationHeader,
    samacsysFirefoxUsername: normalizedUsername,
    samacsysFirefoxPassword: normalizedPassword,
    samacsysFirefoxAuthorizationHeader: normalizedAuthorizationHeader,
    samacsysFirefoxCapturedAuthorizationHeader:
      currentSettings.samacsysFirefoxCapturedAuthorizationHeader || "",
    samacsysFirefoxCapturedAuthorizationCapturedAt:
      currentSettings.samacsysFirefoxCapturedAuthorizationCapturedAt || ""
  };
}

// Load settings from extension storage.
function loadSettings() {
  return loadStoredSettings(chromeApi).then(applySettingsToUi);
}

// Save settings to extension storage.
function saveSettings() {
  const settings = readSettingsFromUi();
  const {
    libraryDownloadRootIsValid,
    samacsysFirefoxProxyBaseUrlIsValid,
    ...storedSettings
  } = settings;
  chromeApi.storage.local.set(storedSettings, () => {
    if (chromeApi.runtime.lastError) {
      setStatus("Failed to save settings.", "error");
      return;
    }
    currentSettings = { ...storedSettings };
    const warnings = [];
    if (!libraryDownloadRootIsValid) {
      warnings.push(
        "Download folder must stay inside Downloads. Reset to the default library folder."
      );
    }
    if (!samacsysFirefoxProxyBaseUrlIsValid) {
      warnings.push(
        "Firefox SamacSys proxy URL must be an absolute http:// or https:// URL. Proxy disabled."
      );
    }
    if (warnings.length) {
      setStatus(warnings.join(" "), "warning");
    }
    if (currentPartContext && isSamacsysProviderShared(currentPartContext.provider)) {
      setPartContext(currentPartContext);
    } else {
      updateDownloadEnabled();
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
    refreshSamacsysAuthStatus();
    return;
  }

  setIdentifierDisplay(
    currentPartContext.sourcePartLabel,
    currentPartContext.sourcePartNumber,
    currentPartContext.manufacturerPartNumber
  );

  if (isBlockedProvider(currentPartContext)) {
    setStatus(
      getBlockedPartContextError(
        currentPartContext,
        popupWindow.navigator?.userAgent,
        currentSettings.samacsysFirefoxProxyBaseUrl
      ),
      "error"
    );
    setDatasheetAvailability(false);
    setPreviewUnavailable(symbolPreviewFallbackEl, symbolPreviewEl, "Unavailable");
    setPreviewUnavailable(footprintPreviewFallbackEl, footprintPreviewEl, "Unavailable");
    updateDownloadEnabled();
    refreshSamacsysAuthStatus();
    return;
  }

  updateDownloadEnabled();
  refreshSamacsysAuthStatus();
  setStatus("");
  requestPreviews(currentPartContext);
}

// Ask the content script in the active tab for the provider-aware part context.
function requestPartContextFromTab(tabId) {
  chromeApi.tabs.sendMessage(tabId, { type: "GET_PART_CONTEXT" }, (response) => {
    if (chromeApi.runtime.lastError) {
      setUnavailableDisplay("Open a supported product page.");
      return;
    }
    setPartContext(response || null);
  });
}

// On popup open, query the active tab and request the current part context.
chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    setUnavailableDisplay("No active tab detected.");
    return;
  }
  currentSourceTabId = tab.id;
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
samacsysFirefoxProxyBaseUrlEl.addEventListener("change", saveSettings);
samacsysFirefoxProxyAuthorizationHeaderEl.addEventListener("change", saveSettings);
samacsysFirefoxUsernameEl.addEventListener("change", saveSettings);
samacsysFirefoxPasswordEl.addEventListener("change", saveSettings);
samacsysFirefoxAuthorizationHeaderEl.addEventListener("change", saveSettings);
resetLibraryDownloadRootEl.addEventListener("click", () => {
  libraryDownloadRootEl.value = DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  saveSettings();
});

// When clicked, validate selections and ask the background worker to export.
downloadButton.addEventListener("click", () => {
  if (!currentPartContext?.provider || isBlockedProvider()) {
    return;
  }

  if (!hasSelection()) {
    setStatus("Select at least one download option.", "error");
    return;
  }

  downloadButton.disabled = true;
  setStatus("Starting download...");

  chromeApi.runtime.sendMessage(
    {
      type: "EXPORT_PART",
      partContext: currentPartContext,
      sourceTabId: currentSourceTabId,
      options: {
        symbol: downloadSymbolEl.checked,
        footprint: downloadFootprintEl.checked,
        model3d: downloadModelEl.checked,
        datasheet: downloadDatasheetEl.checked
      }
    },
    (response) => {
      updateDownloadEnabled();
      if (chromeApi.runtime.lastError) {
        setStatus("Download failed. Check the console.", "error");
        return;
      }
      if (response?.ok) {
        if (response.authRefreshed) {
          currentSettings = {
            ...currentSettings,
            samacsysFirefoxCapturedAuthorizationHeader:
              response.authAuthorizationHeader ||
              currentSettings.samacsysFirefoxCapturedAuthorizationHeader ||
              "captured",
            samacsysFirefoxCapturedAuthorizationCapturedAt:
              response.authCapturedAt ||
              currentSettings.samacsysFirefoxCapturedAuthorizationCapturedAt
          };
          refreshSamacsysAuthStatus();
        }
        const warnings = Array.isArray(response.warnings)
          ? response.warnings.filter(Boolean)
          : [];
        if (warnings.length && response.downloadCount > 0) {
          setStatus(
            `${response.authRefreshed ? "SamacSys auth refreshed. " : ""}Download started. ${warnings.join(" ")}`,
            "warning"
          );
        } else if (warnings.length) {
          setStatus(warnings.join(" "), "warning");
        } else {
          setStatus(
            response.authRefreshed
              ? "SamacSys auth refreshed. Download started."
              : "Download started."
          );
        }
      } else {
        setStatus(response?.error || "Download failed.", "error");
      }
    }
  );
});

if (globalThis.__popupTestApi) {
  Object.assign(globalThis.__popupTestApi, {
    setPartContext,
    updateDownloadEnabled,
    setDatasheetAvailability,
    hasSelection,
    normalizeLibraryDownloadRoot: parseLibraryDownloadRoot,
    getCurrentPartContext: () => currentPartContext,
    elements: {
      manufacturerPartNumberEl,
      sourcePartLabelEl,
      partNumberEl,
      downloadButton,
      statusEl,
      downloadSymbolEl,
      downloadFootprintEl,
      downloadModelEl,
      downloadDatasheetEl,
      downloadDatasheetOptionEl,
      downloadDatasheetLabelEl,
      downloadIndividuallyEl,
      libraryDownloadRootEl,
      resetLibraryDownloadRootEl,
      samacsysFirefoxProxyBaseUrlEl,
      samacsysFirefoxProxyAuthorizationHeaderEl,
      samacsysFirefoxUsernameEl,
      samacsysFirefoxPasswordEl,
      samacsysFirefoxCapturedAuthorizationStatusEl,
      samacsysFirefoxAuthorizationHeaderEl,
      symbolPreviewEl,
      footprintPreviewEl,
      symbolPreviewFallbackEl,
      footprintPreviewFallbackEl
    }
  });
}
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
