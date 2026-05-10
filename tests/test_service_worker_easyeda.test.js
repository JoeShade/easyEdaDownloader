/*
 * These tests cover EasyEDA service-worker preview and export orchestration
 * using mocked fetch, conversion, download, and storage dependencies.
 */

import { describe, expect, it, vi } from "vitest";

import { createCadData, createSymbolLibrary } from "./helpers/fixtures.js";
import { flushAsyncWork } from "./helpers/test_harness.js";
import {
  createServiceWorkerChrome,
  loadServiceWorker,
  sendRuntimeMessage
} from "./helpers/service_worker_harness.js";

describe("service worker EasyEDA flow", () => {
  it("returns EasyEDA preview URLs and datasheet availability for a valid CAD payload", async () => {
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
      type: "GET_PART_PREVIEWS",
      partContext: {
        provider: "easyedaLcsc",
        lookup: {
          lcscId: "C12345"
        }
      }
    });

    expect(result.handled).toBe(true);
    expect(result.response.ok).toBe(true);
    expect(result.response.previews.symbolUrl).toContain("data:image/svg+xml");
    expect(result.response.previews.footprintUrl).toContain("data:image/svg+xml");
    expect(result.response.metadata.datasheetAvailable).toBe(true);
  });

  it("registers the download cleanup listener only once across repeated runtime messages", async () => {
    const cadData = createCadData();
    const { chrome, listeners } = createServiceWorkerChrome();
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: cadData })
      }))
    });

    expect(listeners.downloadsChanged).toHaveLength(1);

    const message = {
      type: "GET_PART_PREVIEWS",
      partContext: {
        provider: "easyedaLcsc",
        lookup: {
          lcscId: "C12345"
        }
      }
    };

    await sendRuntimeMessage(listeners.runtimeMessage[0], message);
    await sendRuntimeMessage(listeners.runtimeMessage[0], message);

    expect(listeners.downloadsChanged).toHaveLength(1);
  });

  it("exports EasyEDA library downloads, merges symbol storage, and cleans up blob URLs", async () => {
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
  (generator "Easy ECAD Downloader")
  (symbol "Logic_Buffer"
    (in_bom yes)
    (on_board yes)
  )
)
`
      },
      footprint: {
        name: "QFN-16/Example",
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
      partContext: {
        provider: "easyedaLcsc",
        lookup: {
          lcscId: "C12345"
        }
      },
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
    expect(filenames).toContain("KiCad/Workspace/datasheets/QFN-16_Example-datasheet.pdf");

    listeners.downloadsChanged[0]({
      id: 1,
      state: { current: "complete" }
    });
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("warns instead of reporting a download when a selected EasyEDA model is missing", async () => {
    const cadData = createCadData();
    cadData.packageDetail.dataStr.shape = cadData.packageDetail.dataStr.shape.filter(
      (shape) => !shape.startsWith("SVGNODE~")
    );
    const { chrome, listeners } = createServiceWorkerChrome();
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: cadData })
      }))
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: {
        provider: "easyedaLcsc",
        lookup: {
          lcscId: "C12345"
        }
      },
      options: {
        symbol: false,
        footprint: false,
        model3d: true,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: ["3D model not available for this part."],
      downloadCount: 0
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
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
      type: "GET_PART_PREVIEWS",
      partContext: {
        provider: "easyedaLcsc",
        lookup: {
          lcscId: "C12345"
        }
      }
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
