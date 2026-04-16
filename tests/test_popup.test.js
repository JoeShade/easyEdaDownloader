import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  flushAsyncWork,
  importRepoModule,
  readRepoFile,
} from "./helpers/test_harness.js";

function createPopupChrome() {
  const state = {
    queryCalls: [],
    tabMessages: [],
    runtimeMessages: [],
    storageGetCalls: [],
    storageSetCalls: []
  };

  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((message, callback) => {
        state.runtimeMessages.push({ message, callback });
      })
    },
    tabs: {
      query: vi.fn((queryInfo, callback) => {
        state.queryCalls.push({ queryInfo, callback });
      }),
      sendMessage: vi.fn((tabId, message, callback) => {
        state.tabMessages.push({ tabId, message, callback });
      })
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

async function loadPopup({ userAgent = "Mozilla/5.0 Chrome/135.0.0.0" } = {}) {
  const dom = new JSDOM(readRepoFile("src/popup.html"), {
    url: "https://example.test/popup.html"
  });
  Object.defineProperty(dom.window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  const { chrome, state } = createPopupChrome();
  const testApi = {};
  globalThis.chrome = chrome;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator
  });
  globalThis.__popupTestApi = testApi;
  await importRepoModule("src/popup.js");
  delete globalThis.__popupTestApi;

  return {
    dom,
    chrome,
    state,
    hooks: testApi
  };
}

function dispatchChange(dom, element) {
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

const EASYEDA_PART_CONTEXT = {
  provider: "easyedaLcsc",
  sourcePartLabel: "LCSC part",
  sourcePartNumber: "C12345",
  manufacturerPartNumber: "SN74LVC1G14DBVR",
  lookup: {
    lcscId: "C12345"
  }
};

const MOUSER_PART_CONTEXT = {
  provider: "mouserSamacsys",
  sourcePartLabel: "Mouser part",
  sourcePartNumber: "511-STM32U3C5RIT6Q",
  manufacturerPartNumber: "STM32U3C5RIT6Q",
  lookup: {
    manufacturerName: "STMicroelectronics",
    entryUrl:
      "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB"
  }
};

const FARNELL_PART_CONTEXT = {
  provider: "farnellSamacsys",
  sourcePartLabel: "Farnell part",
  sourcePartNumber: "1848693",
  manufacturerPartNumber: "FQP27P06",
  lookup: {
    manufacturerName: "ONSEMI",
    entryUrl:
      "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=FQP27P06&pna=farnell&vrq=multi&fmt=zip&lang=en-GB",
    partnerName: "farnell",
    samacsysBaseUrl: "https://farnell.componentsearchengine.com"
  }
};

async function applyStoredSettings(
  state,
  settings = {
    downloadIndividually: false,
    libraryDownloadRoot: "easyEDADownloader",
    samacsysFirefoxProxyBaseUrl: "",
    samacsysFirefoxProxyAuthorizationHeader: "",
    samacsysFirefoxUsername: "",
    samacsysFirefoxPassword: "",
    samacsysFirefoxAuthorizationHeader: "",
    samacsysFirefoxCapturedAuthorizationHeader: "",
    samacsysFirefoxCapturedAuthorizationCapturedAt: ""
  }
) {
  state.storageGetCalls[0].callback(settings);
  await flushAsyncWork();
}

function activatePopupTab(state, tabId) {
  state.queryCalls[0].callback([{ id: tabId }]);
}

describe("popup", () => {
  it("starts in a loading state and requests the active tab plus saved settings", async () => {
    const { state, hooks } = await loadPopup();

    expect(state.queryCalls).toHaveLength(1);
    expect(state.queryCalls[0].queryInfo).toEqual({
      active: true,
      currentWindow: true
    });
    expect(state.storageGetCalls).toHaveLength(1);
    expect(hooks.elements.manufacturerPartNumberEl.textContent).toBe("Searching...");
    expect(hooks.elements.sourcePartLabelEl.textContent).toBe("Part");
    expect(hooks.elements.partNumberEl.textContent).toBe("Searching...");
    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe("");
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value).toBe("");
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.disabled).toBe(true);
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.disabled).toBe(
      true
    );
    expect(hooks.elements.samacsysFirefoxUsernameEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxPasswordEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.value).toBe("");
    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.disabled).toBe(false);
    expect(hooks.elements.samacsysRelayRuntimeHintEl.hidden).toBe(false);
    expect(
      hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent.trim()
    ).toBe("No Firefox-captured SamacSys auth header yet.");
    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.type).toBe(
      "password"
    );
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(hooks.elements.symbolPreviewFallbackEl.textContent).toBe("Loading...");
    expect(hooks.elements.footprintPreviewFallbackEl.textContent).toBe("Loading...");
  });

  it("loads an EasyEDA part context and enables download only when a selection exists", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state, {
      downloadIndividually: true,
      libraryDownloadRoot: "KiCad\\easyEDA"
    });
    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(true);
    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA");

    activatePopupTab(state, 7);
    expect(state.tabMessages[0]).toMatchObject({
      tabId: 7,
      message: { type: "GET_PART_CONTEXT" }
    });

    const partContext = EASYEDA_PART_CONTEXT;
    state.tabMessages[0].callback(partContext);
    expect(state.runtimeMessages[0].message).toEqual({
      type: "GET_PART_PREVIEWS",
      partContext
    });

    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolUrl: "data:image/svg+xml;utf8,%3Csvg%20%2F%3E",
        footprintUrl: "data:image/svg+xml;utf8,%3Csvg%20%2F%3E"
      },
      metadata: {
        datasheetAvailable: true
      }
    });
    await flushAsyncWork();

    expect(hooks.getCurrentPartContext()).toEqual(partContext);
    expect(hooks.elements.sourcePartLabelEl.textContent).toBe("LCSC part");
    expect(hooks.elements.manufacturerPartNumberEl.textContent).toBe(
      "SN74LVC1G14DBVR"
    );
    expect(hooks.elements.partNumberEl.textContent).toBe("C12345");
    expect(hooks.elements.downloadButton.disabled).toBe(false);
    expect(hooks.elements.symbolPreviewEl.src).toContain("data:image/svg+xml");
    expect(hooks.elements.footprintPreviewEl.src).toContain("data:image/svg+xml");

    hooks.elements.downloadSymbolEl.checked = false;
    hooks.elements.downloadFootprintEl.checked = false;
    hooks.elements.downloadModelEl.checked = false;
    dispatchChange(dom, hooks.elements.downloadSymbolEl);
    dispatchChange(dom, hooks.elements.downloadFootprintEl);
    dispatchChange(dom, hooks.elements.downloadModelEl);
    expect(hooks.elements.downloadButton.disabled).toBe(true);

    hooks.elements.downloadSymbolEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadSymbolEl);
    expect(hooks.elements.downloadButton.disabled).toBe(false);
  });

  it("renders a Mouser provider context, uses PNG previews, and disables datasheet export", async () => {
    const { state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    activatePopupTab(state, 8);

    const partContext = MOUSER_PART_CONTEXT;

    state.tabMessages[0].callback(partContext);
    expect(state.runtimeMessages[0].message).toEqual({
      type: "GET_PART_PREVIEWS",
      partContext
    });

    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolUrl: "data:image/png;base64,AAAA",
        footprintUrl: "data:image/png;base64,BBBB"
      },
      metadata: {
        datasheetAvailable: false
      }
    });
    await flushAsyncWork();

    expect(hooks.elements.sourcePartLabelEl.textContent).toBe("Mouser part");
    expect(hooks.elements.partNumberEl.textContent).toBe("511-STM32U3C5RIT6Q");
    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.downloadDatasheetLabelEl.textContent).toBe(
      "Datasheet (not available)"
    );
    expect(hooks.elements.symbolPreviewEl.src).toContain("data:image/png;base64");
    expect(hooks.elements.footprintPreviewEl.src).toContain("data:image/png;base64");

    hooks.elements.downloadDatasheetEl.checked = false;
    hooks.elements.downloadButton.click();
    expect(state.runtimeMessages[1].message).toEqual({
      type: "EXPORT_PART",
      partContext,
      sourceTabId: 8,
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });
  });

  it("keeps Mouser datasheet export disabled when previews fail", async () => {
    const { state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    activatePopupTab(state, 8);

    const partContext = MOUSER_PART_CONTEXT;

    state.tabMessages[0].callback(partContext);
    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.downloadDatasheetLabelEl.textContent).toBe(
      "Datasheet (not available)"
    );

    state.runtimeMessages[0].callback({
      ok: false,
      error: "Preview failed."
    });
    await flushAsyncWork();

    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.downloadDatasheetEl.checked).toBe(false);
    expect(hooks.elements.downloadDatasheetLabelEl.textContent).toBe(
      "Datasheet (not available)"
    );
  });

  it("blocks Mouser downloads on Firefox with the proxy-required message", async () => {
    const { state, hooks } = await loadPopup({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state);
    activatePopupTab(state, 10);
    state.tabMessages[0].callback(MOUSER_PART_CONTEXT);

    expect(hooks.elements.statusEl.textContent).toContain("Chrome-only for now");
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(hooks.elements.symbolPreviewFallbackEl.textContent).toBe("Unavailable");
    expect(hooks.elements.footprintPreviewFallbackEl.textContent).toBe(
      "Unavailable"
    );
    expect(state.runtimeMessages).toHaveLength(0);
  });

  it("allows Firefox SamacSys previews when an advanced proxy URL is configured", async () => {
    const { state, hooks } = await loadPopup({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state, {
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
    });
    activatePopupTab(state, 12);
    state.tabMessages[0].callback(MOUSER_PART_CONTEXT);

    expect(state.runtimeMessages[0].message).toEqual({
      type: "GET_PART_PREVIEWS",
      partContext: MOUSER_PART_CONTEXT
    });

    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolUrl: "data:image/png;base64,AAAA",
        footprintUrl: "data:image/png;base64,BBBB"
      },
      metadata: {
        datasheetAvailable: false
      }
    });
    await flushAsyncWork();

    expect(hooks.elements.statusEl.textContent).toBe("");
    expect(hooks.elements.downloadButton.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.disabled).toBe(
      false
    );
    expect(hooks.elements.samacsysFirefoxUsernameEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxPasswordEl.disabled).toBe(false);
    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.disabled).toBe(false);
    expect(hooks.elements.samacsysRelayRuntimeHintEl.hidden).toBe(true);
  });

  it("treats Farnell SamacSys pages like Mouser for preview defaults and Firefox blocking", async () => {
    const { state, hooks } = await loadPopup({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    await applyStoredSettings(state);
    activatePopupTab(state, 11);
    state.tabMessages[0].callback(FARNELL_PART_CONTEXT);

    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.statusEl.textContent).toContain("Chrome-only for now");
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(state.runtimeMessages).toHaveLength(0);
  });

  it("saves settings when the download organization toggle changes", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadIndividuallyEl);

    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: true,
        libraryDownloadRoot: "easyEDADownloader",
        samacsysFirefoxProxyBaseUrl: "",
        samacsysFirefoxProxyAuthorizationHeader: "",
        samacsysFirefoxUsername: "",
        samacsysFirefoxPassword: "",
        samacsysFirefoxAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationCapturedAt: ""
      }
    ]);
  });

  it("normalizes and saves the library download root from the popup", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.libraryDownloadRootEl.value = "  KiCad\\\\easyEDA//Parts  ";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA/Parts");
    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: false,
        libraryDownloadRoot: "KiCad/easyEDA/Parts",
        samacsysFirefoxProxyBaseUrl: "",
        samacsysFirefoxProxyAuthorizationHeader: "",
        samacsysFirefoxUsername: "",
        samacsysFirefoxPassword: "",
        samacsysFirefoxAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationCapturedAt: ""
      }
    ]);
  });

  it("normalizes and saves the Firefox SamacSys proxy URL from advanced settings", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value = " https://proxy.example.test/relay#frag ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);

    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe(
      "https://proxy.example.test/relay"
    );
    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: false,
        libraryDownloadRoot: "easyEDADownloader",
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxProxyAuthorizationHeader: "",
        samacsysFirefoxUsername: "",
        samacsysFirefoxPassword: "",
        samacsysFirefoxAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationCapturedAt: ""
      }
    ]);
  });

  it("normalizes and saves the Firefox SamacSys proxy Authorization header", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value =
      " Authorization: Bearer relay123 ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl);

    expect(hooks.elements.samacsysFirefoxProxyAuthorizationHeaderEl.value).toBe(
      "Bearer relay123"
    );
    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: false,
        libraryDownloadRoot: "easyEDADownloader",
        samacsysFirefoxProxyBaseUrl: "",
        samacsysFirefoxProxyAuthorizationHeader: "Bearer relay123",
        samacsysFirefoxUsername: "",
        samacsysFirefoxPassword: "",
        samacsysFirefoxAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationCapturedAt: ""
      }
    ]);
  });

  it("normalizes and saves the manual SamacSys Authorization override", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxAuthorizationHeaderEl.value =
      " Authorization: Basic abc123 ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxAuthorizationHeaderEl);

    expect(hooks.elements.samacsysFirefoxAuthorizationHeaderEl.value).toBe(
      "Basic abc123"
    );
    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: false,
        libraryDownloadRoot: "easyEDADownloader",
        samacsysFirefoxProxyBaseUrl: "",
        samacsysFirefoxProxyAuthorizationHeader: "",
        samacsysFirefoxUsername: "",
        samacsysFirefoxPassword: "",
        samacsysFirefoxAuthorizationHeader: "Basic abc123",
        samacsysFirefoxCapturedAuthorizationHeader: "",
        samacsysFirefoxCapturedAuthorizationCapturedAt: ""
      }
    ]);
  });

  it("trims and saves the optional SamacSys username and password", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxUsernameEl.value = "  user@example.com  ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxUsernameEl);
    hooks.elements.samacsysFirefoxPasswordEl.value = "  secret123  ";
    dispatchChange(dom, hooks.elements.samacsysFirefoxPasswordEl);

    expect(hooks.elements.samacsysFirefoxUsernameEl.value).toBe("user@example.com");
    expect(hooks.elements.samacsysFirefoxPasswordEl.value).toBe("secret123");
    expect(state.storageSetCalls[0]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxUsername: "user@example.com",
      samacsysFirefoxPassword: "",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
    expect(state.storageSetCalls[1]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxUsername: "user@example.com",
      samacsysFirefoxPassword: "secret123",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
  });

  it("shows captured SamacSys auth status without exposing the secret", async () => {
    const { state, hooks } = await loadPopup();

    await applyStoredSettings(state, {
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "Basic captured-secret",
      samacsysFirefoxCapturedAuthorizationCapturedAt: "2026-04-14T11:40:00.000Z"
    });

    expect(hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent).toContain(
      "Firefox-captured SamacSys auth header available from"
    );
    expect(hooks.elements.samacsysFirefoxCapturedAuthorizationStatusEl.textContent).not.toContain(
      "captured-secret"
    );
  });

  it("warns and disables the proxy setting when the advanced URL is invalid", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    hooks.elements.samacsysFirefoxProxyBaseUrlEl.value = "not-a-url";
    dispatchChange(dom, hooks.elements.samacsysFirefoxProxyBaseUrlEl);

    expect(hooks.elements.samacsysFirefoxProxyBaseUrlEl.value).toBe("");
    expect(hooks.elements.statusEl.textContent).toContain(
      "Firefox SamacSys proxy URL must be an absolute http:// or https:// URL."
    );
    expect(state.storageSetCalls[0]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxUsername: "",
      samacsysFirefoxPassword: "",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
  });

  it("resets invalid or cleared library folder values to the default root", async () => {
    const { dom, state, hooks } = await loadPopup();

    await applyStoredSettings(state, {
      downloadIndividually: false,
      libraryDownloadRoot: "Projects/KiCad"
    });

    hooks.elements.libraryDownloadRootEl.value = "../outside";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(hooks.elements.statusEl.textContent).toContain("inside Downloads");
    expect(hooks.elements.statusEl.classList.contains("warning")).toBe(true);
    expect(state.storageSetCalls[0]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxUsername: "",
      samacsysFirefoxPassword: "",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });

    hooks.elements.libraryDownloadRootEl.value = "Nested/Parts";
    hooks.elements.resetLibraryDownloadRootEl.click();

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(state.storageSetCalls[1]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "",
      samacsysFirefoxProxyAuthorizationHeader: "",
      samacsysFirefoxUsername: "",
      samacsysFirefoxPassword: "",
      samacsysFirefoxAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
  });

  it("shows identifiers as unavailable when the content script cannot respond", async () => {
    const { chrome, state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    activatePopupTab(state, 11);
    chrome.runtime.lastError = { message: "No receiver." };
    state.tabMessages[0].callback(undefined);

    expect(hooks.elements.manufacturerPartNumberEl.textContent).toBe("Unavailable");
    expect(hooks.elements.partNumberEl.textContent).toBe("Unavailable");
    expect(hooks.elements.statusEl.textContent).toBe(
      "Open a supported product page."
    );
    expect(hooks.elements.downloadButton.disabled).toBe(true);
  });

  it("surfaces export errors in the popup status area", async () => {
    const { state, hooks } = await loadPopup();

    await applyStoredSettings(state);
    activatePopupTab(state, 9);
    const partContext = {
      ...EASYEDA_PART_CONTEXT,
      sourcePartNumber: "C90000",
      manufacturerPartNumber: "LM358PWR",
      lookup: {
        lcscId: "C90000"
      }
    };
    state.tabMessages[0].callback(partContext);
    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolUrl: "data:image/svg+xml;utf8,%3Csvg%20%2F%3E",
        footprintUrl: "data:image/svg+xml;utf8,%3Csvg%20%2F%3E"
      },
      metadata: {
        datasheetAvailable: true
      }
    });
    await flushAsyncWork();

    hooks.elements.downloadButton.click();
    state.runtimeMessages[1].callback({
      ok: false,
      error: "Download failed."
    });
    await flushAsyncWork();

    expect(hooks.elements.statusEl.textContent).toBe("Download failed.");
    expect(hooks.elements.statusEl.classList.contains("error")).toBe(true);
  });
});

// SamacSys/relay work in this file: JoeShade and Josh Webster
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
