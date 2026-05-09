/*
 * These tests cover the dedicated settings page that owns persistent extension
 * preferences. They keep popup behavior focused while ensuring settings still
 * normalize, save, and hide captured secret values correctly.
 */

import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  flushAsyncWork,
  importRepoModule,
  readRepoFile
} from "./helpers/test_harness.js";

const DEFAULT_STORED_SETTINGS = {
  downloadIndividually: false,
  libraryDownloadRoot: "easyEDADownloader",
  samacsysFirefoxProxyBaseUrl: "",
  samacsysFirefoxProxyAuthorizationHeader: "",
  samacsysFirefoxUsername: "",
  samacsysFirefoxPassword: "",
  samacsysFirefoxAuthorizationHeader: "",
  samacsysFirefoxCapturedAuthorizationHeader: "",
  samacsysFirefoxCapturedAuthorizationCapturedAt: "",
  rememberSamacsysCredentials: false,
  rememberSamacsysFirefoxProxyAuthorizationHeader: false
};

const DEFAULT_SESSION_SETTINGS = {
  samacsysFirefoxProxyAuthorizationHeader: "",
  samacsysFirefoxUsername: "",
  samacsysFirefoxPassword: "",
  samacsysFirefoxCapturedAuthorizationHeader: "",
  samacsysFirefoxCapturedAuthorizationCapturedAt: ""
};

function createSettingsChrome({ sessionStorageState = {} } = {}) {
  const state = {
    storageGetCalls: [],
    storageSetCalls: [],
    sessionGetCalls: [],
    sessionSetCalls: []
  };
  const sessionStorage = { ...sessionStorageState };

  const chrome = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get: vi.fn((defaults, callback) => {
          state.storageGetCalls.push({ defaults, callback });
        }),
        set: vi.fn((items, callback) => {
          state.storageSetCalls.push(items);
          callback?.();
        })
      },
      session: {
        get: vi.fn((defaults, callback) => {
          state.sessionGetCalls.push({ defaults, callback });
          callback({
            ...defaults,
            ...sessionStorage
          });
        }),
        set: vi.fn((items, callback) => {
          state.sessionSetCalls.push(items);
          Object.assign(sessionStorage, items);
          callback?.();
        })
      }
    }
  };

  return { chrome, state };
}

async function loadSettingsPage({
  userAgent = "Mozilla/5.0 Chrome/135.0.0.0",
  sessionStorageState = {}
} = {}) {
  const dom = new JSDOM(readRepoFile("src/settings.html"), {
    url: "https://example.test/settings.html"
  });
  Object.defineProperty(dom.window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  const { chrome, state } = createSettingsChrome({ sessionStorageState });
  const testApi = {};
  globalThis.chrome = chrome;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator
  });
  globalThis.__settingsPageTestApi = testApi;
  await importRepoModule("src/settings_page.js");
  delete globalThis.__settingsPageTestApi;

  return {
    dom,
    chrome,
    state,
    hooks: testApi
  };
}

async function applyStoredSettings(state, settings = DEFAULT_STORED_SETTINGS) {
  state.storageGetCalls[0].callback(settings);
  await flushAsyncWork();
}

function dispatchChange(dom, element) {
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function dispatchInput(dom, element) {
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

async function saveChanges(hooks) {
  hooks.elements.saveSettingsEl.click();
  await flushAsyncWork();
}

describe("settings page", () => {
  it("keeps hidden runtime-specific sections visually hidden", () => {
    const settingsPageCss = readRepoFile("src/settings_page.css");

    expect(settingsPageCss).toContain(
      "[hidden] {\n  display: none !important;\n}"
    );
    expect(settingsPageCss).toContain(".primary:not(:disabled):hover");
    expect(settingsPageCss).toContain(".danger:not(:disabled):hover");
    expect(settingsPageCss).toContain("min-height: 100vh;");
    expect(settingsPageCss).toContain("margin: auto 0 0;");
  });

  it("loads saved settings and hides Firefox-only fields outside Firefox", async () => {
    const { dom, state, hooks } = await loadSettingsPage({
      sessionStorageState: {
        samacsysFirefoxCapturedAuthorizationHeader: "Basic captured-secret",
        samacsysFirefoxCapturedAuthorizationCapturedAt: new Date().toISOString()
      }
    });

    expect(state.storageGetCalls).toHaveLength(1);
    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      downloadIndividually: true,
      libraryDownloadRoot: "KiCad\\easyEDA",
      samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay#frag",
      samacsysFirefoxProxyAuthorizationHeader: "Authorization: Bearer relay123",
      samacsysFirefoxUsername: " user@example.com ",
      samacsysFirefoxPassword: " secret123 ",
      samacsysFirefoxAuthorizationHeader: "Authorization: Basic manual123",
      rememberSamacsysCredentials: true,
      rememberSamacsysFirefoxProxyAuthorizationHeader: true
    });

    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(true);
    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA");
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe(
      "https://proxy.example.test/relay"
    );
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value).toBe("");
    expect(hooks.elements.helperSecretStatusEl.textContent).toBe(
      "Helper password/token remembered on this device."
    );
    expect(hooks.elements.helperSecretStatusEl.previousElementSibling).toBe(
      hooks.elements.clearHelperSecretEl
    );
    expect(hooks.elements.samacsysFirefoxUsernameEl.value).toBe(
      "user@example.com"
    );
    expect(hooks.elements.samacsysFirefoxPasswordEl.value).toBe("");
    expect(hooks.elements.samacsysCredentialsStatusEl.textContent).toBe(
      "SamacSys password remembered on this device."
    );
    expect(hooks.elements.samacsysCredentialsStatusEl.previousElementSibling).toBe(
      hooks.elements.clearSamacsysCredentialsEl
    );
    expect(hooks.elements.firefoxAdvancedSettingsEl.hidden).toBe(true);
    expect(hooks.elements.firefoxRelaySectionEl.hidden).toBe(true);
    expect(hooks.elements.firefoxCapturedAuthorizationFieldEl.hidden).toBe(true);
    expect(
      hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent
    ).toContain("Saved Firefox sign-in from");
    expect(
      hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent
    ).not.toContain("captured-secret");
    expect(hooks.elements.saveSettingsEl.disabled).toBe(true);
    expect(hooks.elements.discardSettingsEl.disabled).toBe(true);
    expect(hooks.elements.saveSettingsEl.textContent.trim()).toBe("Save");
    expect(hooks.elements.discardSettingsEl.textContent.trim()).toBe("Discard");
    expect(hooks.elements.discardSettingsEl.classList.contains("danger")).toBe(
      true
    );
    expect(hooks.elements.saveSettingsEl.previousElementSibling).toBe(
      hooks.elements.statusEl
    );
    expect(dom.window.document.querySelector(".footer-link")?.href).toBe(
      "https://github.com/JoeShade/easyEdaDownloader"
    );
  });

  it("saves download layout settings from the options page", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state);
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadIndividuallyEl);
    await flushAsyncWork();

    expect(state.storageSetCalls).toEqual([]);
    expect(hooks.elements.saveSettingsEl.disabled).toBe(false);
    await saveChanges(hooks);

    expect(state.storageSetCalls[0]).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      downloadIndividually: true
    });

    hooks.elements.libraryDownloadRootEl.value = "  KiCad\\\\easyEDA//Parts  ";
    dispatchInput(dom, hooks.elements.libraryDownloadRootEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA/Parts");
    expect(state.storageSetCalls[1]).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      downloadIndividually: true,
      libraryDownloadRoot: "KiCad/easyEDA/Parts"
    });
    expect(hooks.elements.statusEl.textContent).toBe("Settings saved.");
  });

  it("saves Firefox helper token and SamacSys credentials for this session by default", async () => {
    const { dom, state, hooks } = await loadSettingsPage({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxAuthorizationHeader: "Authorization: Basic existing123"
    });
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.disabled).toBe(
      false
    );
    expect(hooks.elements.firefoxAdvancedSettingsEl.hidden).toBe(false);
    expect(hooks.elements.firefoxAdvancedSettingsEl.open).toBe(false);
    expect(hooks.elements.firefoxRelaySectionEl.hidden).toBe(false);
    expect(hooks.elements.firefoxCapturedAuthorizationFieldEl.hidden).toBe(false);

    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value =
      " https://proxy.example.test/relay#frag ";
    dispatchInput(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);
    await flushAsyncWork();
    hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value =
      " Authorization: Bearer relay123 ";
    dispatchInput(dom, hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl);
    await flushAsyncWork();
    hooks.elements.samacsysFirefoxUsernameEl.value = "  user@example.com  ";
    dispatchInput(dom, hooks.elements.samacsysFirefoxUsernameEl);
    await flushAsyncWork();
    hooks.elements.samacsysFirefoxPasswordEl.value = "  secret123  ";
    dispatchInput(dom, hooks.elements.samacsysFirefoxPasswordEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(state.storageSetCalls.at(-1)).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
      samacsysFirefoxAuthorizationHeader: "Basic existing123"
    });
    expect(state.sessionSetCalls.at(-1)).toEqual({
      ...DEFAULT_SESSION_SETTINGS,
      samacsysFirefoxProxyAuthorizationHeader: "Bearer relay123",
      samacsysFirefoxUsername: "user@example.com",
      samacsysFirefoxPassword: "secret123"
    });
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value).toBe("");
    expect(hooks.elements.samacsysFirefoxPasswordEl.value).toBe("");
    expect(hooks.elements.helperSecretStatusEl.textContent).toBe(
      "Helper password/token saved for this browser session."
    );
    expect(hooks.elements.samacsysCredentialsStatusEl.textContent).toBe(
      "SamacSys password saved for this browser session."
    );
  });

  it("remembers secrets on this device only when the opt-in boxes are checked", async () => {
    const { dom, state, hooks } = await loadSettingsPage({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value =
      " Authorization: Bearer relay123 ";
    hooks.elements.samacsysFirefoxUsernameEl.value = "user@example.com";
    hooks.elements.samacsysFirefoxPasswordEl.value = " secret123 ";
    hooks.elements.rememberSamacsysFirefoxProxyAuthorizationHeaderEl.checked = true;
    hooks.elements.rememberSamacsysCredentialsEl.checked = true;
    dispatchChange(
      dom,
      hooks.elements.rememberSamacsysFirefoxProxyAuthorizationHeaderEl
    );
    await flushAsyncWork();
    dispatchChange(dom, hooks.elements.rememberSamacsysCredentialsEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(state.storageSetCalls.at(-1)).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxProxyAuthorizationHeader: "Bearer relay123",
      samacsysFirefoxUsername: "user@example.com",
      samacsysFirefoxPassword: "secret123",
      rememberSamacsysCredentials: true,
      rememberSamacsysFirefoxProxyAuthorizationHeader: true
    });
    expect(state.sessionSetCalls.at(-1)).toEqual(DEFAULT_SESSION_SETTINGS);
    expect(hooks.elements.helperSecretStatusEl.textContent).toBe(
      "Helper password/token remembered on this device."
    );
    expect(hooks.elements.samacsysCredentialsStatusEl.textContent).toBe(
      "SamacSys password remembered on this device."
    );
  });

  it("warns and normalizes invalid setting values", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      libraryDownloadRoot: "Projects/KiCad"
    });
    hooks.elements.libraryDownloadRootEl.value = "../outside";
    dispatchInput(dom, hooks.elements.libraryDownloadRootEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(hooks.elements.statusEl.textContent).toContain("inside Downloads");
    expect(hooks.elements.statusEl.classList.contains("warning")).toBe(true);
    expect(state.storageSetCalls[0]).toEqual(DEFAULT_STORED_SETTINGS);

    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value = "not-a-url";
    dispatchInput(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe("");
    expect(hooks.elements.statusEl.textContent).toContain(
      "The helper service URL must start with http:// or https://."
    );
    expect(state.storageSetCalls[1]).toEqual(DEFAULT_STORED_SETTINGS);
  });

  it("resets the library folder to the default root", async () => {
    const { state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      libraryDownloadRoot: "Nested/Parts"
    });
    hooks.elements.resetLibraryDownloadRootEl.click();
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(state.storageSetCalls[0]).toEqual(DEFAULT_STORED_SETTINGS);
  });

  it("discards unsaved changes and restores the loaded settings", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      libraryDownloadRoot: "KiCad/Saved"
    });
    hooks.elements.libraryDownloadRootEl.value = "Changed/Folder";
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchInput(dom, hooks.elements.libraryDownloadRootEl);
    await flushAsyncWork();

    hooks.elements.discardSettingsEl.click();
    await flushAsyncWork();

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/Saved");
    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(false);
    expect(hooks.elements.statusEl.textContent).toBe("Changes discarded.");
    expect(state.storageSetCalls).toEqual([]);
    expect(hooks.elements.saveSettingsEl.disabled).toBe(true);
  });

  it("does not keep a hidden password after clearing SamacSys sign-in", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxUsername: "saved@example.com",
      samacsysFirefoxPassword: "stored-password",
      rememberSamacsysCredentials: true
    });
    hooks.elements.clearSamacsysCredentialsEl.click();
    hooks.elements.samacsysFirefoxUsernameEl.value = "new@example.com";
    dispatchInput(dom, hooks.elements.samacsysFirefoxUsernameEl);
    await flushAsyncWork();
    await saveChanges(hooks);

    expect(state.storageSetCalls.at(-1)).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxUsername: "new@example.com",
      rememberSamacsysCredentials: true
    });
  });
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
