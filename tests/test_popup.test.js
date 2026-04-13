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
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(hooks.elements.symbolPreviewFallbackEl.textContent).toBe("Loading...");
    expect(hooks.elements.footprintPreviewFallbackEl.textContent).toBe("Loading...");
  });

  it("loads an EasyEDA part context and enables download only when a selection exists", async () => {
    const { dom, state, hooks } = await loadPopup();

    state.storageGetCalls[0].callback({
      downloadIndividually: true,
      libraryDownloadRoot: "KiCad\\easyEDA"
    });
    await flushAsyncWork();
    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(true);
    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA");

    state.queryCalls[0].callback([{ id: 7 }]);
    expect(state.tabMessages[0]).toMatchObject({
      tabId: 7,
      message: { type: "GET_PART_CONTEXT" }
    });

    const partContext = {
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
      sourcePartNumber: "C12345",
      manufacturerPartNumber: "SN74LVC1G14DBVR",
      lookup: {
        lcscId: "C12345"
      }
    };
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

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 8 }]);

    const partContext = {
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

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 8 }]);

    const partContext = {
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

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 10 }]);
    state.tabMessages[0].callback({
      provider: "mouserSamacsys",
      sourcePartLabel: "Mouser part",
      sourcePartNumber: "511-STM32U3C5RIT6Q",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      lookup: {
        manufacturerName: "STMicroelectronics",
        entryUrl: "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB"
      }
    });

    expect(hooks.elements.statusEl.textContent).toContain("Chrome-only for now");
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(hooks.elements.symbolPreviewFallbackEl.textContent).toBe("Unavailable");
    expect(hooks.elements.footprintPreviewFallbackEl.textContent).toBe(
      "Unavailable"
    );
    expect(state.runtimeMessages).toHaveLength(0);
  });

  it("treats Farnell SamacSys pages like Mouser for preview defaults and Firefox blocking", async () => {
    const { state, hooks } = await loadPopup({
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 11 }]);
    state.tabMessages[0].callback({
      provider: "farnellSamacsys",
      sourcePartLabel: "Farnell part",
      sourcePartNumber: "1848693",
      manufacturerPartNumber: "FQP27P06",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl: "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=FQP27P06&pna=farnell&vrq=multi&fmt=zip&lang=en-GB",
        partnerName: "farnell",
        samacsysBaseUrl: "https://farnell.componentsearchengine.com"
      }
    });

    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.statusEl.textContent).toContain("Chrome-only for now");
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(state.runtimeMessages).toHaveLength(0);
  });

  it("saves settings when the download organization toggle changes", async () => {
    const { dom, state, hooks } = await loadPopup();

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadIndividuallyEl);

    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: true,
        libraryDownloadRoot: "easyEDADownloader"
      }
    ]);
  });

  it("normalizes and saves the library download root from the popup", async () => {
    const { dom, state, hooks } = await loadPopup();

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    hooks.elements.libraryDownloadRootEl.value = "  KiCad\\\\easyEDA//Parts  ";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("KiCad/easyEDA/Parts");
    expect(state.storageSetCalls).toEqual([
      {
        downloadIndividually: false,
        libraryDownloadRoot: "KiCad/easyEDA/Parts"
      }
    ]);
  });

  it("resets invalid or cleared library folder values to the default root", async () => {
    const { dom, state, hooks } = await loadPopup();

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "Projects/KiCad"
    });
    await flushAsyncWork();

    hooks.elements.libraryDownloadRootEl.value = "../outside";
    dispatchChange(dom, hooks.elements.libraryDownloadRootEl);

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(hooks.elements.statusEl.textContent).toContain("inside Downloads");
    expect(hooks.elements.statusEl.classList.contains("warning")).toBe(true);
    expect(state.storageSetCalls[0]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });

    hooks.elements.libraryDownloadRootEl.value = "Nested/Parts";
    hooks.elements.resetLibraryDownloadRootEl.click();

    expect(hooks.elements.libraryDownloadRootEl.value).toBe("easyEDADownloader");
    expect(state.storageSetCalls[1]).toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
  });

  it("shows identifiers as unavailable when the content script cannot respond", async () => {
    const { chrome, state, hooks } = await loadPopup();

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 11 }]);
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

    state.storageGetCalls[0].callback({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader"
    });
    await flushAsyncWork();
    state.queryCalls[0].callback([{ id: 9 }]);
    const partContext = {
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
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
