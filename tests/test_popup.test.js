import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  flushAsyncWork,
  readRepoFile,
  runSourceFile
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

function loadPopup() {
  const dom = new JSDOM(readRepoFile("src/popup.html"), {
    url: "https://example.test/popup.html"
  });
  const { chrome, state } = createPopupChrome();

  const context = runSourceFile("src/popup.js", {
    context: {
      chrome,
      document: dom.window.document,
      window: dom.window,
      Event: dom.window.Event
    },
    append: `
globalThis.__testExports = {
  setPartNumber,
  updateDownloadEnabled,
  setDatasheetAvailability,
  hasSelection,
  getCurrentLcscId: () => currentLcscId,
  elements: {
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
    symbolPreviewEl,
    footprintPreviewEl,
    symbolPreviewFallbackEl,
    footprintPreviewFallbackEl
  }
};
`
  });

  return {
    dom,
    state,
    hooks: context.__testExports
  };
}

function dispatchChange(dom, element) {
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

describe("popup", () => {
  it("starts in a loading state and requests the active tab plus saved settings", () => {
    const { state, hooks } = loadPopup();

    expect(state.queryCalls).toHaveLength(1);
    expect(state.queryCalls[0].queryInfo).toEqual({
      active: true,
      currentWindow: true
    });
    expect(state.storageGetCalls).toHaveLength(1);
    expect(hooks.elements.partNumberEl.textContent).toBe("Searching...");
    expect(hooks.elements.downloadButton.disabled).toBe(true);
    expect(hooks.elements.symbolPreviewFallbackEl.textContent).toBe("Loading...");
    expect(hooks.elements.footprintPreviewFallbackEl.textContent).toBe("Loading...");
  });

  it("loads settings and enables the download button only when a part and selection exist", async () => {
    const { dom, state, hooks } = loadPopup();

    state.storageGetCalls[0].callback({ downloadIndividually: true });
    expect(hooks.elements.downloadIndividuallyEl.checked).toBe(true);

    state.queryCalls[0].callback([{ id: 7 }]);
    expect(state.tabMessages[0]).toMatchObject({
      tabId: 7,
      message: { type: "GET_LCSC_ID" }
    });

    state.tabMessages[0].callback({ lcscId: "C12345" });
    expect(state.runtimeMessages[0].message).toEqual({
      type: "GET_PREVIEW_SVGS",
      lcscId: "C12345"
    });

    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolSvg: "<svg><rect /></svg>",
        footprintSvg: "<svg><circle /></svg>"
      },
      metadata: {
        datasheetAvailable: true
      }
    });
    await flushAsyncWork();

    expect(hooks.getCurrentLcscId()).toBe("C12345");
    expect(hooks.elements.partNumberEl.textContent).toBe("C12345");
    expect(hooks.elements.downloadButton.disabled).toBe(false);
    expect(hooks.elements.symbolPreviewEl.src).toContain("data:image/svg+xml;utf8,");
    expect(hooks.elements.footprintPreviewEl.src).toContain("data:image/svg+xml;utf8,");

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

  it("saves settings when the download organization toggle changes", () => {
    const { dom, state, hooks } = loadPopup();

    state.storageGetCalls[0].callback({ downloadIndividually: false });
    hooks.elements.downloadIndividuallyEl.checked = true;
    dispatchChange(dom, hooks.elements.downloadIndividuallyEl);

    expect(state.storageSetCalls).toEqual([{ downloadIndividually: true }]);
  });

  it("updates datasheet availability and reports export warnings", async () => {
    const { state, hooks } = loadPopup();

    state.storageGetCalls[0].callback({ downloadIndividually: false });
    state.queryCalls[0].callback([{ id: 8 }]);
    state.tabMessages[0].callback({ lcscId: "C55555" });

    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolSvg: "<svg><rect /></svg>",
        footprintSvg: "<svg><circle /></svg>"
      },
      metadata: {
        datasheetAvailable: false
      }
    });
    await flushAsyncWork();

    expect(hooks.elements.downloadDatasheetEl.disabled).toBe(true);
    expect(hooks.elements.downloadDatasheetLabelEl.textContent).toBe(
      "Datasheet (not available)"
    );

    hooks.elements.downloadSymbolEl.checked = true;
    hooks.elements.downloadFootprintEl.checked = false;
    hooks.elements.downloadModelEl.checked = false;
    hooks.elements.downloadButton.click();

    expect(state.runtimeMessages[1].message).toEqual({
      type: "EXPORT_PART",
      lcscId: "C55555",
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false,
        downloadIndividually: false
      }
    });

    state.runtimeMessages[1].callback({
      ok: true,
      downloadCount: 1,
      warnings: ["Datasheet not available for this part."]
    });
    await flushAsyncWork();

    expect(hooks.elements.statusEl.textContent).toContain("Datasheet not available");
    expect(hooks.elements.statusEl.classList.contains("warning")).toBe(true);
    expect(hooks.elements.downloadButton.disabled).toBe(false);
  });

  it("surfaces export errors in the popup status area", async () => {
    const { state, hooks } = loadPopup();

    state.storageGetCalls[0].callback({ downloadIndividually: false });
    state.queryCalls[0].callback([{ id: 9 }]);
    state.tabMessages[0].callback({ lcscId: "C90000" });
    state.runtimeMessages[0].callback({
      ok: true,
      previews: {
        symbolSvg: "<svg />",
        footprintSvg: "<svg />"
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
