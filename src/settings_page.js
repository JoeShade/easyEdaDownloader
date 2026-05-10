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
  parseSamacsysProxyAuthorizationHeader,
  parseSamacsysFirefoxProxyBaseUrl
} from "./core/settings.js";
import { isFirefoxRuntime } from "./core/part_context.js";

const chromeApi = globalThis.chrome;
const settingsWindow = globalThis.window;
const settingsDocument = globalThis.document;

const settingsForm = settingsDocument.getElementById("settingsForm");
const statusEl = settingsDocument.getElementById("status");
const saveSettingsEl = settingsDocument.getElementById("saveSettings");
const discardSettingsEl = settingsDocument.getElementById("discardSettings");
const downloadIndividuallyEl = settingsDocument.getElementById(
  "downloadIndividually"
);
const libraryDownloadRootEl = settingsDocument.getElementById("libraryDownloadRoot");
const resetLibraryDownloadRootEl = settingsDocument.getElementById(
  "resetLibraryDownloadRoot"
);
const firefoxAdvancedSettingsEl = settingsDocument.getElementById(
  "firefoxAdvancedSettings"
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
const rememberSamacsysFirefoxProxyAuthorizationHeaderEl =
  settingsDocument.getElementById(
    "rememberSamacsysFirefoxProxyAuthorizationHeader"
  );
const helperSecretStatusEl = settingsDocument.getElementById("helperSecretStatus");
const clearHelperSecretEl = settingsDocument.getElementById("clearHelperSecret");
const samacsysFirefoxUsernameEl = settingsDocument.getElementById(
  "samacsysFirefoxUsername"
);
const samacsysFirefoxPasswordEl = settingsDocument.getElementById(
  "samacsysFirefoxPassword"
);
const rememberSamacsysCredentialsEl = settingsDocument.getElementById(
  "rememberSamacsysCredentials"
);
const samacsysCredentialsStatusEl = settingsDocument.getElementById(
  "samacsysCredentialsStatus"
);
const clearSamacsysCredentialsEl = settingsDocument.getElementById(
  "clearSamacsysCredentials"
);
const passwordToggleButtons = Array.from(
  settingsDocument.querySelectorAll("[data-password-toggle]")
);
const isFirefoxSettingsRuntime = isFirefoxRuntime(
  settingsWindow.navigator?.userAgent
);

const PASSWORD_TOGGLE_LABELS = {
  samacsysFirefoxPassword: "SamacSys password",
  samacsysFirefoxProxyAuthorizationHeader: "authentication token"
};

let currentSettings = { ...DEFAULT_SETTINGS };
let hasUnsavedChanges = false;
let pendingClearHelperSecret = false;
let pendingClearSamacsysCredentials = false;

function setStatus(message, tone = "default") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", tone === "error");
  statusEl.classList.toggle("warning", tone === "warning");
}

function hasSecretValue(value) {
  return Boolean(String(value || "").trim());
}

function updateActionState() {
  saveSettingsEl.disabled = !hasUnsavedChanges;
  discardSettingsEl.disabled = !hasUnsavedChanges;
}

function markDirty(message = "Unsaved changes.") {
  hasUnsavedChanges = true;
  updateSecretStatuses();
  updateActionState();
  setStatus(message);
}

function setStorageArea(area, items) {
  return new Promise((resolve, reject) => {
    if (!area?.set) {
      reject(new Error("Storage is unavailable."));
      return;
    }
    area.set(items, () => {
      if (chromeApi.runtime.lastError) {
        reject(new Error(chromeApi.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function getSessionStorageArea() {
  return chromeApi.storage?.session || null;
}

function updateSecretStatuses() {
  if (pendingClearHelperSecret) {
    helperSecretStatusEl.textContent =
      "Authentication token will be cleared when you save.";
  } else if (hasSecretValue(samacsysFirefoxProxyAuthorizationHeaderEl.value)) {
    helperSecretStatusEl.textContent =
      "New authentication token ready to save.";
  } else if (hasSecretValue(currentSettings.samacsysFirefoxProxyAuthorizationHeader)) {
    helperSecretStatusEl.textContent =
      currentSettings.rememberSamacsysFirefoxProxyAuthorizationHeader
        ? "Authentication token remembered on this device."
        : "Authentication token saved for this browser session.";
  } else {
    helperSecretStatusEl.textContent = "No authentication token saved.";
  }

  if (pendingClearSamacsysCredentials) {
    samacsysCredentialsStatusEl.textContent =
      "SamacSys sign-in will be cleared when you save.";
  } else if (hasSecretValue(samacsysFirefoxPasswordEl.value)) {
    samacsysCredentialsStatusEl.textContent =
      "New SamacSys password ready to save.";
  } else if (hasSecretValue(currentSettings.samacsysFirefoxPassword)) {
    samacsysCredentialsStatusEl.textContent =
      currentSettings.rememberSamacsysCredentials
        ? "SamacSys password remembered on this device."
        : "SamacSys password saved for this browser session.";
  } else {
    samacsysCredentialsStatusEl.textContent = "No SamacSys password saved.";
  }
}

function clearSecretInputs() {
  samacsysFirefoxProxyAuthorizationHeaderEl.value = "";
  samacsysFirefoxPasswordEl.value = "";
  hidePasswordInputs();
}

function clearPendingSecretActions() {
  pendingClearHelperSecret = false;
  pendingClearSamacsysCredentials = false;
}

function updateRelaySettingsAvailability() {
  firefoxAdvancedSettingsEl.hidden = !isFirefoxSettingsRuntime;
  firefoxRelaySectionEl.hidden = !isFirefoxSettingsRuntime;
  samacsysFirefoxProxyBaseUrlEl.disabled = !isFirefoxSettingsRuntime;
  samacsysFirefoxProxyAuthorizationHeaderEl.disabled = !isFirefoxSettingsRuntime;
  updatePasswordToggleAvailability();
}

function getPasswordToggleTarget(button) {
  return settingsDocument.getElementById(button.dataset.passwordToggle);
}

function setPasswordToggleState(button, input, isVisible) {
  if (!input) {
    return;
  }

  const label = PASSWORD_TOGGLE_LABELS[input.id] || "password";
  const action = isVisible ? "Hide" : "Show";
  input.type = isVisible ? "text" : "password";
  button.classList.toggle("is-visible", isVisible);
  button.setAttribute("aria-pressed", String(isVisible));
  button.setAttribute("aria-label", `${action} ${label}`);
  button.title = `${action} ${label}`;
}

function hidePasswordInputs() {
  for (const button of passwordToggleButtons) {
    setPasswordToggleState(button, getPasswordToggleTarget(button), false);
  }
}

function updatePasswordToggleAvailability() {
  for (const button of passwordToggleButtons) {
    const input = getPasswordToggleTarget(button);
    const isDisabled = !input || input.disabled;
    if (isDisabled) {
      setPasswordToggleState(button, input, false);
    }
    button.disabled = isDisabled;
  }
}

function togglePasswordVisibility(event) {
  const button = event.currentTarget;
  const input = getPasswordToggleTarget(button);
  if (!input || input.disabled || button.disabled) {
    return;
  }

  setPasswordToggleState(button, input, input.type === "password");
  input.focus();
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

  downloadIndividuallyEl.checked =
    typeof settings.downloadIndividually === "boolean"
      ? settings.downloadIndividually
      : DEFAULT_SETTINGS.downloadIndividually;
  libraryDownloadRootEl.value = normalizedRoot.value;
  samacsysFirefoxProxyBaseUrlEl.value = normalizedProxy.value;
  samacsysFirefoxProxyAuthorizationHeaderEl.value = "";
  samacsysFirefoxUsernameEl.value = normalizedUsername;
  samacsysFirefoxPasswordEl.value = "";
  rememberSamacsysFirefoxProxyAuthorizationHeaderEl.checked = Boolean(
    settings.rememberSamacsysFirefoxProxyAuthorizationHeader
  );
  rememberSamacsysCredentialsEl.checked = Boolean(
    settings.rememberSamacsysCredentials
  );
  currentSettings = {
    downloadIndividually: downloadIndividuallyEl.checked,
    libraryDownloadRoot: normalizedRoot.value,
    samacsysFirefoxProxyBaseUrl: normalizedProxy.value,
    samacsysFirefoxProxyAuthorizationHeader: normalizedProxyAuthorizationHeader,
    samacsysFirefoxUsername: normalizedUsername,
    samacsysFirefoxPassword: normalizedPassword,
    rememberSamacsysCredentials: Boolean(settings.rememberSamacsysCredentials),
    rememberSamacsysFirefoxProxyAuthorizationHeader: Boolean(
      settings.rememberSamacsysFirefoxProxyAuthorizationHeader
    )
  };
  clearPendingSecretActions();
  hidePasswordInputs();
  hasUnsavedChanges = false;
  updateSecretStatuses();
  updateRelaySettingsAvailability();
  updateActionState();
}

function readSettingsFromUi() {
  const normalizedRoot = parseLibraryDownloadRoot(libraryDownloadRootEl.value);
  const normalizedProxy = parseSamacsysFirefoxProxyBaseUrl(
    samacsysFirefoxProxyBaseUrlEl.value
  );
  const normalizedProxyAuthorizationHeader = pendingClearHelperSecret
    ? ""
    : parseSamacsysProxyAuthorizationHeader(
        samacsysFirefoxProxyAuthorizationHeaderEl.value
      ) || currentSettings.samacsysFirefoxProxyAuthorizationHeader || "";
  const normalizedUsername = parseSamacsysCredentialValue(
    samacsysFirefoxUsernameEl.value
  );
  const normalizedPassword = pendingClearSamacsysCredentials
    ? ""
    : parseSamacsysCredentialValue(samacsysFirefoxPasswordEl.value) ||
      currentSettings.samacsysFirefoxPassword ||
      "";

  libraryDownloadRootEl.value = normalizedRoot.value;
  samacsysFirefoxProxyBaseUrlEl.value = normalizedProxy.value;
  samacsysFirefoxUsernameEl.value = normalizedUsername;

  return {
    downloadIndividually: Boolean(downloadIndividuallyEl.checked),
    libraryDownloadRoot: normalizedRoot.value,
    libraryDownloadRootIsValid: normalizedRoot.isValid,
    samacsysFirefoxProxyBaseUrl: normalizedProxy.value,
    samacsysFirefoxProxyBaseUrlIsValid: normalizedProxy.isValid,
    samacsysFirefoxProxyAuthorizationHeader: normalizedProxyAuthorizationHeader,
    samacsysFirefoxUsername: normalizedUsername,
    samacsysFirefoxPassword: normalizedPassword,
    rememberSamacsysCredentials: Boolean(rememberSamacsysCredentialsEl.checked),
    rememberSamacsysFirefoxProxyAuthorizationHeader: Boolean(
      rememberSamacsysFirefoxProxyAuthorizationHeaderEl.checked
    )
  };
}

function buildLocalSettings(settings) {
  return {
    downloadIndividually: settings.downloadIndividually,
    libraryDownloadRoot: settings.libraryDownloadRoot,
    samacsysFirefoxProxyBaseUrl: settings.samacsysFirefoxProxyBaseUrl,
    samacsysFirefoxProxyAuthorizationHeader:
      settings.rememberSamacsysFirefoxProxyAuthorizationHeader
        ? settings.samacsysFirefoxProxyAuthorizationHeader
        : "",
    samacsysFirefoxUsername: settings.rememberSamacsysCredentials
      ? settings.samacsysFirefoxUsername
      : "",
    samacsysFirefoxPassword: settings.rememberSamacsysCredentials
      ? settings.samacsysFirefoxPassword
      : "",
    rememberSamacsysCredentials: settings.rememberSamacsysCredentials,
    rememberSamacsysFirefoxProxyAuthorizationHeader:
      settings.rememberSamacsysFirefoxProxyAuthorizationHeader
  };
}

function buildSessionSettings(settings) {
  return {
    samacsysFirefoxProxyAuthorizationHeader:
      settings.rememberSamacsysFirefoxProxyAuthorizationHeader
        ? ""
        : settings.samacsysFirefoxProxyAuthorizationHeader,
    samacsysFirefoxUsername: settings.rememberSamacsysCredentials
      ? ""
      : settings.samacsysFirefoxUsername,
    samacsysFirefoxPassword: settings.rememberSamacsysCredentials
      ? ""
      : settings.samacsysFirefoxPassword
  };
}

function needsSessionStorage(settings) {
  return (
    (!settings.rememberSamacsysFirefoxProxyAuthorizationHeader &&
      hasSecretValue(settings.samacsysFirefoxProxyAuthorizationHeader)) ||
    (!settings.rememberSamacsysCredentials &&
      (hasSecretValue(settings.samacsysFirefoxUsername) ||
        hasSecretValue(settings.samacsysFirefoxPassword)))
  );
}

async function saveSettings() {
  const settings = readSettingsFromUi();
  const {
    libraryDownloadRootIsValid,
    samacsysFirefoxProxyBaseUrlIsValid,
    ...normalizedSettings
  } = settings;

  try {
    const sessionStorageArea = getSessionStorageArea();
    if (needsSessionStorage(normalizedSettings) && !sessionStorageArea) {
      setStatus(
        "This browser cannot keep session-only sign-in details. Tick remember on this device, or leave the secret fields blank.",
        "error"
      );
      return;
    }

    await setStorageArea(
      chromeApi.storage.local,
      buildLocalSettings(normalizedSettings)
    );
    if (sessionStorageArea) {
      await setStorageArea(
        sessionStorageArea,
        buildSessionSettings(normalizedSettings)
      );
    }

    currentSettings = { ...normalizedSettings };
    clearPendingSecretActions();
    hasUnsavedChanges = false;
    clearSecretInputs();
    updateSecretStatuses();
    updateActionState();
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
  } catch (error) {
    setStatus(error?.message || "Failed to save settings.", "error");
  }
}

function loadSettings() {
  return loadStoredSettings(chromeApi).then(applySettingsToUi);
}

function resetLibraryDownloadRoot() {
  libraryDownloadRootEl.value = DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  markDirty();
}

function clearHelperSecret() {
  pendingClearHelperSecret = true;
  samacsysFirefoxProxyAuthorizationHeaderEl.value = "";
  hidePasswordInputs();
  markDirty();
}

function clearSamacsysCredentials() {
  pendingClearSamacsysCredentials = true;
  samacsysFirefoxUsernameEl.value = "";
  samacsysFirefoxPasswordEl.value = "";
  hidePasswordInputs();
  markDirty();
}

function discardSettings() {
  applySettingsToUi(currentSettings);
  setStatus("Changes discarded.");
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings();
});

downloadIndividuallyEl.addEventListener("change", () => markDirty());
libraryDownloadRootEl.addEventListener("input", () => markDirty());
samacsysFirefoxProxyBaseUrlEl.addEventListener("input", () => markDirty());
samacsysFirefoxProxyAuthorizationHeaderEl.addEventListener("input", () => {
  pendingClearHelperSecret = false;
  markDirty();
});
rememberSamacsysFirefoxProxyAuthorizationHeaderEl.addEventListener(
  "change",
  () => markDirty()
);
samacsysFirefoxUsernameEl.addEventListener("input", () => markDirty());
samacsysFirefoxPasswordEl.addEventListener("input", () => {
  pendingClearSamacsysCredentials = false;
  markDirty();
});
rememberSamacsysCredentialsEl.addEventListener("change", () => markDirty());
resetLibraryDownloadRootEl.addEventListener("click", resetLibraryDownloadRoot);
clearHelperSecretEl.addEventListener("click", clearHelperSecret);
clearSamacsysCredentialsEl.addEventListener("click", clearSamacsysCredentials);
discardSettingsEl.addEventListener("click", discardSettings);
for (const button of passwordToggleButtons) {
  button.addEventListener("click", togglePasswordVisibility);
}

loadSettings();
updateRelaySettingsAvailability();
updateActionState();

if (globalThis.__settingsPageTestApi) {
  Object.assign(globalThis.__settingsPageTestApi, {
    applySettingsToUi,
    readSettingsFromUi,
    saveSettings,
    discardSettings,
    clearHelperSecret,
    clearSamacsysCredentials,
    hidePasswordInputs,
    togglePasswordVisibility,
    elements: {
      settingsForm,
      statusEl,
      saveSettingsEl,
      discardSettingsEl,
      downloadIndividuallyEl,
      libraryDownloadRootEl,
      resetLibraryDownloadRootEl,
      firefoxAdvancedSettingsEl,
      firefoxRelaySectionEl,
      samacsysFirefoxProxyBaseUrlEl,
      samacsysFirefoxProxyAuthorizationHeaderEl,
      toggleSamacsysFirefoxProxyAuthorizationHeaderEl: settingsDocument
        .getElementById("toggleSamacsysFirefoxProxyAuthorizationHeader"),
      rememberSamacsysFirefoxProxyAuthorizationHeaderEl,
      helperSecretStatusEl,
      clearHelperSecretEl,
      samacsysFirefoxUsernameEl,
      samacsysFirefoxPasswordEl,
      toggleSamacsysFirefoxPasswordEl: settingsDocument.getElementById(
        "toggleSamacsysFirefoxPassword"
      ),
      rememberSamacsysCredentialsEl,
      samacsysCredentialsStatusEl,
      clearSamacsysCredentialsEl
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
