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
  samacsysFirefoxCapturedAuthorizationCapturedAt: ""
};

function createSettingsChrome() {
  const state = {
    storageGetCalls: [],
    storageSetCalls: []
  };

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
      }
    }
  };

  return { chrome, state };
}

async function loadSettingsPage({
  userAgent = "Mozilla/5.0 Chrome/135.0.0.0"
} = {}) {
  const dom = new JSDOM(readRepoFile("src/settings.html"), {
    url: "https://example.test/settings.html"
  });
  Object.defineProperty(dom.window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  const { chrome, state } = createSettingsChrome();
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

describe("settings page", () => {
  it("keeps hidden runtime-specific sections visually hidden", () => {
    expect(readRepoFile("src/settings_page.css")).toContain(
      "[hidden] {\n  display: none !important;\n}"
    );
  });

  it("loads saved settings and hides Firefox-only fields outside Firefox", async () => {
    const { state, hooks } = await loadSettingsPage();

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
      samacsysFirefoxCapturedAuthorizationHeader: "Basic captured-secret",
      samacsysFirefoxCapturedAuthorizationCapturedAt:
        "2026-04-14T11:40:00.000Z"
    });

    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(true);
    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA");
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe(
      "https://proxy.example.test/relay"
    );
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value).toBe(
      "Bearer relay123"
    );
    expect(hooks.elements.samacsysFirefoxUsernameEl.value).toBe(
      "user@example.com"
    );
    expect(hooks.elements.samacsysFirefoxPasswordEl.value).toBe("secret123");
    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.value).toBe(
      "Basic manual123"
    );
    expect(hooks.elements.firefoxRelaySectionEl.hidden).toBe(true);
    expect(hooks.elements.firefoxCapturedAuthorizationFieldEl.hidden).toBe(true);
    expect(hooks.elements.firefoxCapturedAuthorizationHintEl.hidden).toBe(true);
    expect(hooks.elements.samacsysRelayRuntimeHintEl.hidden).toBe(true);
    expect(
      hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent
    ).toContain("Saved Firefox sign-in from");
    expect(
      hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent
    ).not.toContain("captured-secret");
  });

  it("saves download layout settings from the options page", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state);
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadIndividuallyEl);

    expect(state.storageSetCalls[0]).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      downloadIndividually: true
    });

    hooks.elements.libraryDownloadRootEl.value = "  KiCad\\\\easyEDA//Parts  ";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA/Parts");
    expect(state.storageSetCalls[1]).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      downloadIndividually: true,
      libraryDownloadRoot: "KiCad/easyEDA/Parts"
    });
    expect(hooks.elements.statusEl.textContent).toBe("Settings saved.");
  });

  it("saves Firefox relay and SamacSys auth settings", async () => {
    const { dom, state, hooks } = await loadSettingsPage({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state);
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.disabled).toBe(
      false
    );
    expect(hooks.elements.firefoxRelaySectionEl.hidden).toBe(false);
    expect(hooks.elements.firefoxCapturedAuthorizationFieldEl.hidden).toBe(false);
    expect(hooks.elements.firefoxCapturedAuthorizationHintEl.hidden).toBe(false);
    expect(hooks.elements.samacsysRelayRuntimeHintEl.hidden).toBe(true);

    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value =
      " https://proxy.example.test/relay#frag ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);
    hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value =
      " Authorization: Bearer relay123 ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl);
    hooks.elements.samacsysFirefoxUsernameEl.value = "  user@example.com  ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxUsernameEl);
    hooks.elements.samacsysFirefoxPasswordEl.value = "  secret123  ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxPasswordEl);
    hooks.elements.samacsysFirefoxAuthorizationHeaderEl.value =
      " Authorization: Basic manual123 ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxAuthorizationHeaderEl);

    expect(state.storageSetCalls.at(-1)).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
      samacsysFirefoxProxyAuthorizationHeader: "Bearer relay123",
      samacsysFirefoxUsername: "user@example.com",
      samacsysFirefoxPassword: "secret123",
      samacsysFirefoxAuthorizationHeader: "Basic manual123"
    });
  });

  it("warns and normalizes invalid setting values", async () => {
    const { dom, state, hooks } = await loadSettingsPage();

    await applyStoredSettings(state, {
      ...DEFAULT_STORED_SETTINGS,
      libraryDownloadRoot: "Projects/KiCad"
    });
    hooks.elements.libraryDownloadRootEl.value = "../outside";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(hooks.elements.statusEl.textContent).toContain("inside Downloads");
    expect(hooks.elements.statusEl.classList.contains("warning")).toBe(true);
    expect(state.storageSetCalls[0]).toEqual(DEFAULT_STORED_SETTINGS);

    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value = "not-a-url";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);

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

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(state.storageSetCalls[0]).toEqual(DEFAULT_STORED_SETTINGS);
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
