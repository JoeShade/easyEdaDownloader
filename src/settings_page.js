// SamacSys/relay work in this file: JoeShade and Josh Webster
/*
 * Settings page controller for persistent extension preferences. It owns the
 * settings form that used to live in the popup and keeps storage normalization
 * aligned with the shared worker settings helpers.
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
import { isFirefoxRuntime } from "./core/part_context.js";

const chromeApi = globalThis.chrome;
const settingsWindow = globalThis.window;
const settingsDocument = globalThis.document;

const settingsForm = settingsDocument.getElementById("settingsForm");
const statusEl = settingsDocument.getElementById("status");
const downloadIndividuallyEl = settingsDocument.getElementById(
  "downloadIndividually"
);
const libraryDownloadRootEl = settingsDocument.getElementById("libraryDownloadRoot");
const resetLibraryDownloadRootEl = settingsDocument.getElementById(
  "resetLibraryDownloadRoot"
);
const firefoxRelaySectionEl = settingsDocument.getElementById(
  "firefoxRelaySection"
);
const samacsysFirefoxProxyBaseUrlEl = settingsDocument.getElementById(
  "samacsysFirefoxProxyBaseUrl"
);
const samacsysFirefoxProxyAuthorizationHeaderEl = settingsDocument.getElementById(
  "samacsysFirefoxProxyAuthorizationHeader"
);
const samacsysFirefoxUsernameEl = settingsDocument.getElementById(
  "samacsysFirefoxUsername"
);
const samacsysFirefoxPasswordEl = settingsDocument.getElementById(
  "samacsysFirefoxPassword"
);
const samacsysFirefoxCapturedAuthorizationStatusEl =
  settingsDocument.getElementById("samacsysFirefoxCapturedAuthorizationStatus");
const firefoxCapturedAuthorizationFieldEl = settingsDocument.getElementById(
  "firefoxCapturedAuthorizationField"
);
const firefoxCapturedAuthorizationHintEl = settingsDocument.getElementById(
  "firefoxCapturedAuthorizationHint"
);
const samacsysFirefoxAuthorizationHeaderEl = settingsDocument.getElementById(
  "samacsysFirefoxAuthorizationHeader"
);
const samacsysRelayRuntimeHintEl = settingsDocument.getElementById(
  "samacsysRelayRuntimeHint"
);
const isFirefoxSettingsRuntime = isFirefoxRuntime(
  settingsWindow.navigator?.userAgent
);

let currentSettings = { ...DEFAULT_SETTINGS };

function setStatus(message, tone = "default") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", tone === "error");
  statusEl.classList.toggle("warning", tone === "warning");
}

function formatCapturedAuthorizationStatus(
  capturedAuthorizationHeader,
  capturedAuthorizationCapturedAt
) {
  if (!capturedAuthorizationHeader) {
    return "No saved Firefox sign-in yet.";
  }

  if (!capturedAuthorizationCapturedAt) {
    return "Saved Firefox sign-in available.";
  }

  const capturedDate = new Date(capturedAuthorizationCapturedAt);
  if (Number.isNaN(capturedDate.getTime())) {
    return "Saved Firefox sign-in available.";
  }

  return `Saved Firefox sign-in from ${capturedDate.toLocaleString()}.`;
}

function updateRelaySettingsAvailability() {
  firefoxRelaySectionEl.hidden = !isFirefoxSettingsRuntime;
  firefoxCapturedAuthorizationFieldEl.hidden = !isFirefoxSettingsRuntime;
  firefoxCapturedAuthorizationHintEl.hidden = !isFirefoxSettingsRuntime;
  samacsysFirefoxProxyBaseUrlEl.disabled = !isFirefoxSettingsRuntime;
  samacsysFirefoxProxyAuthorizationHeaderEl.disabled = !isFirefoxSettingsRuntime;
  samacsysRelayRuntimeHintEl.hidden = true;
}

function refreshSamacsysAuthStatus() {
  samacsysFirefoxCapturedAuthorizationStatusEl.textContent =
    formatCapturedAuthorizationStatus(
      currentSettings.samacsysFirefoxCapturedAuthorizationHeader,
      currentSettings.samacsysFirefoxCapturedAuthorizationCapturedAt
    );
}

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
  updateRelaySettingsAvailability();
}

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
    refreshSamacsysAuthStatus();
    const warnings = [];
    if (!libraryDownloadRootIsValid) {
      warnings.push(
        "The folder must be inside Downloads. Reset to the default folder."
      );
    }
    if (!samacsysFirefoxProxyBaseUrlIsValid) {
      warnings.push(
        "The helper service URL must start with http:// or https://. It has been cleared."
      );
    }
    setStatus(
      warnings.length ? warnings.join(" ") : "Settings saved.",
      warnings.length ? "warning" : "default"
    );
  });
}

function loadSettings() {
  return loadStoredSettings(chromeApi).then(applySettingsToUi);
}

function resetLibraryDownloadRoot() {
  libraryDownloadRootEl.value = DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  saveSettings();
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

downloadIndividuallyEl.addEventListener("change", saveSettings);
libraryDownloadRootEl.addEventListener("change", saveSettings);
samacsysFirefoxProxyBaseUrlEl.addEventListener("change", saveSettings);
samacsysFirefoxProxyAuthorizationHeaderEl.addEventListener("change", saveSettings);
samacsysFirefoxUsernameEl.addEventListener("change", saveSettings);
samacsysFirefoxPasswordEl.addEventListener("change", saveSettings);
samacsysFirefoxAuthorizationHeaderEl.addEventListener("change", saveSettings);
resetLibraryDownloadRootEl.addEventListener("click", resetLibraryDownloadRoot);

loadSettings();
updateRelaySettingsAvailability();

if (globalThis.__settingsPageTestApi) {
  Object.assign(globalThis.__settingsPageTestApi, {
    applySettingsToUi,
    readSettingsFromUi,
    saveSettings,
    formatCapturedAuthorizationStatus,
    elements: {
      settingsForm,
      statusEl,
      downloadIndividuallyEl,
      libraryDownloadRootEl,
      resetLibraryDownloadRootEl,
      firefoxRelaySectionEl,
      samacsysFirefoxProxyBaseUrlEl,
      samacsysFirefoxProxyAuthorizationHeaderEl,
      samacsysFirefoxUsernameEl,
      samacsysFirefoxPasswordEl,
      samacsysFirefoxCapturedAuthorizationStatusEl,
      firefoxCapturedAuthorizationFieldEl,
      firefoxCapturedAuthorizationHintEl,
      samacsysFirefoxAuthorizationHeaderEl,
      samacsysRelayRuntimeHintEl
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
