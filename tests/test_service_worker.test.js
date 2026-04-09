import { describe, expect, it, vi } from "vitest";

import { createCadData, createSymbolLibrary } from "./helpers/fixtures.js";
import {
  flushAsyncWork,
  replaceExactImport,
  runSourceFile
} from "./helpers/test_harness.js";

function createServiceWorkerChrome({ storageState = {} } = {}) {
  const listeners = {
    runtimeMessage: [],
    downloadsChanged: []
  };
  const storage = { ...storageState };
  let nextDownloadId = 1;

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.runtimeMessage.push(listener);
        }
      }
    },
    downloads: {
      download: vi.fn((options, callback) => {
        const downloadId = nextDownloadId++;
        callback?.(downloadId);
        return downloadId;
      }),
      onChanged: {
        addListener(listener) {
          listeners.downloadsChanged.push(listener);
        }
      }
    },
    storage: {
      local: {
        get: vi.fn((defaults, callback) => {
          if (typeof defaults === "string") {
            callback({ [defaults]: storage[defaults] ?? "" });
            return;
          }
          const result = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            result[key] = Object.prototype.hasOwnProperty.call(storage, key)
              ? storage[key]
              : fallback;
          }
          callback(result);
        }),
        set: vi.fn((items, callback) => {
          Object.assign(storage, items);
          callback?.();
        })
      }
    },
    tabs: {
      sendMessage: vi.fn()
    }
  };

  return { chrome, listeners, storage };
}

function loadServiceWorker({
  chrome,
  fetchImpl,
  convertEasyedaCadToKicad = vi.fn(() => ({})),
  convertObjToWrlString = vi.fn(() => "#VRML")
}) {
  class MockURL extends URL {}
  MockURL.createObjectURL = vi.fn(() => "blob:download");
  MockURL.revokeObjectURL = vi.fn();

  const context = runSourceFile("src/service_worker.js", {
    context: {
      chrome,
      fetch: fetchImpl,
      URL: MockURL,
      Blob,
      __converter: {
        convertEasyedaCadToKicad,
        convertObjToWrlString
      }
    },
    transforms: [
      (source) =>
        replaceExactImport(
          source,
          'import { convertEasyedaCadToKicad, convertObjToWrlString } from "./kicad_converter.js";',
          "const { convertEasyedaCadToKicad, convertObjToWrlString } = globalThis.__converter;"
        )
    ],
    append: `
globalThis.__testExports = {
  exportPart,
  fetchCadData,
  buildLibraryPaths,
  normalizeLibraryDownloadRoot,
  getDatasheetInfo,
  extractSymbolBlock,
  mergeSymbolIntoLibrary
};
`
  });

  return {
    hooks: context.__testExports,
    urlApi: MockURL
  };
}

function sendRuntimeMessage(listener, message) {
  return new Promise((resolve) => {
    const handled = listener(message, null, (response) => resolve({ handled, response }));
    if (handled === false) {
      resolve({ handled, response: undefined });
    }
  });
}

describe("service worker", () => {
  it("returns preview SVGs and datasheet availability for a valid CAD payload", async () => {
    const cadData = createCadData();
    const { chrome, listeners } = createServiceWorkerChrome();
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: cadData })
      }))
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PREVIEW_SVGS",
      lcscId: "C12345"
    });

    expect(result.handled).toBe(true);
    expect(result.response.ok).toBe(true);
    expect(result.response.previews.symbolSvg).toContain("<svg");
    expect(result.response.previews.footprintSvg).toContain("<svg");
    expect(result.response.metadata.datasheetAvailable).toBe(true);
  });

  it("exports library-structured downloads, merges symbol storage, and cleans up blob URLs", async () => {
    const cadData = createCadData();
    const { chrome, listeners, storage } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: false,
        libraryDownloadRoot: "KiCad/Workspace",
        "symbolLibrary:KiCad/Workspace/Workspace.kicad_sym":
          createSymbolLibrary()
      }
    });
    const convertEasyedaCadToKicad = vi.fn(() => ({
      symbol: {
        name: "Logic_Buffer",
        content: `(kicad_symbol_lib
  (version 20211014)
  (generator "easy EDA downloader")
  (symbol "Logic_Buffer"
    (in_bom yes)
    (on_board yes)
  )
)
`
      },
      footprint: {
        name: "QFN-16_Example",
        content: "(module easyeda2kicad:QFN-16_Example)"
      }
    }));
    const convertObjToWrlString = vi.fn(() => "#VRML");
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/api/products/")) {
        return {
          ok: true,
          json: async () => ({ result: cadData })
        };
      }
      if (String(url).includes("/qAxj6KHrDKw4blvCG8QJPs7Y/")) {
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("step").buffer
        };
      }
      if (String(url).includes("/3dmodel/")) {
        return {
          ok: true,
          text: async () => "obj data"
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { urlApi } = loadServiceWorker({
      chrome,
      fetchImpl,
      convertEasyedaCadToKicad,
      convertObjToWrlString
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      lcscId: "C12345",
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: true
      }
    });
    await flushAsyncWork();

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 5
    });
    expect(convertEasyedaCadToKicad).toHaveBeenCalledWith(cadData, {
      symbol: true,
      footprint: true
    });
    expect(convertObjToWrlString).toHaveBeenCalledWith("obj data");
    expect(storage["symbolLibrary:KiCad/Workspace/Workspace.kicad_sym"]).toContain(
      '(symbol "ExistingSymbol"'
    );
    expect(storage["symbolLibrary:KiCad/Workspace/Workspace.kicad_sym"]).toContain(
      '(symbol "Logic_Buffer"'
    );

    const filenames = chrome.downloads.download.mock.calls.map(
      ([options]) => options.filename
    );
    expect(filenames).toContain("KiCad/Workspace/Workspace.kicad_sym");
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.pretty/QFN-16_Example.kicad_mod"
    );
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.3dshapes/Model_QFN.step"
    );
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.3dshapes/Model_QFN.wrl"
    );
    expect(filenames).toContain("KiCad/Workspace/QFN-16_Example-datasheet.pdf");

    listeners.downloadsChanged[0]({
      id: 1,
      state: { current: "complete" }
    });
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("returns a warning when datasheet export is requested but no datasheet URL exists", async () => {
    const cadData = createCadData({ datasheetUrl: "" });
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true
      }
    });
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: cadData })
      }))
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      lcscId: "C12345",
      options: {
        symbol: false,
        footprint: false,
        model3d: false,
        datasheet: true
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: ["Datasheet not available for this part."],
      downloadCount: 0
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it("keeps loose-file downloads rooted in Downloads even when a library folder is configured", async () => {
    const cadData = createCadData();
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace"
      }
    });

    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: cadData })
      })),
      convertEasyedaCadToKicad: vi.fn(() => ({
        symbol: {
          name: "Logic_Buffer",
          content: "(kicad_symbol_lib)"
        },
        footprint: {
          name: "QFN-16_Example",
          content: "(module easyeda2kicad:QFN-16_Example)"
        }
      }))
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      lcscId: "C12345",
      options: {
        symbol: true,
        footprint: true,
        model3d: false,
        datasheet: true
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 3
    });

    const filenames = chrome.downloads.download.mock.calls.map(
      ([options]) => options.filename
    );
    expect(filenames).toContain("C12345-Logic_Buffer.kicad_sym");
    expect(filenames).toContain("QFN-16_Example.kicad_mod");
    expect(filenames).toContain("QFN-16_Example-datasheet.pdf");
    expect(
      filenames.some((filename) => filename.startsWith("KiCad/Workspace/"))
    ).toBe(false);
  });

  it("reports invalid EasyEDA payloads as structured preview failures", async () => {
    const { chrome, listeners } = createServiceWorkerChrome();
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "missing-result" })
      }))
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PREVIEW_SVGS",
      lcscId: "C12345"
    });

    expect(result.response.ok).toBe(false);
    expect(result.response.error).toContain("EasyEDA API returned no component data");
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
