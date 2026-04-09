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
    }
  };

  return { chrome, listeners, storage };
}

function loadServiceWorker({
  chrome,
  fetchImpl,
  userAgent = "Mozilla/5.0 Chrome/135.0.0.0",
  convertEasyedaCadToKicad = vi.fn(() => ({})),
  convertObjToWrlString = vi.fn(() => "#VRML"),
  readZipEntries = vi.fn(async () => [])
}) {
  class MockURL extends URL {}
  MockURL.createObjectURL = vi.fn(() => "blob:download");
  MockURL.revokeObjectURL = vi.fn();

  const context = runSourceFile("src/service_worker.js", {
    context: {
      chrome,
      fetch: fetchImpl,
      navigator: { userAgent },
      URL: MockURL,
      Blob,
      __converter: {
        convertEasyedaCadToKicad,
        convertObjToWrlString
      },
      __zipReader: {
        readZipEntries
      }
    },
    transforms: [
      (source) =>
        replaceExactImport(
          source,
          'import { convertEasyedaCadToKicad, convertObjToWrlString } from "./kicad_converter.js";',
          "const { convertEasyedaCadToKicad, convertObjToWrlString } = globalThis.__converter;"
        ),
      (source) =>
        replaceExactImport(
          source,
          'import { readZipEntries } from "./vendor/zip_reader.js";',
          "const { readZipEntries } = globalThis.__zipReader;"
        )
    ],
    append: `
globalThis.__testExports = {
  exportPart,
  getPartPreviews,
  buildLibraryPaths,
  normalizeLibraryDownloadRoot,
  getDatasheetInfo,
  extractSymbolBlock,
  mergeSymbolIntoLibrary,
  rewriteSamacsysSymbolFootprintReference,
  rewriteSamacsysFootprintModelPath,
  stripKicadFootprintModels
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

function createMouserPartContext() {
  return {
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
}

function createMouserPartHtml({ token = "tok123", partId = "21790508" } = {}) {
  return `
    <html>
      <body>
        <form id="zipForm" action="https://ms.componentsearchengine.com/ga/model.php" method="GET">
          <input type="hidden" name="partner" value="Mouser" />
          <input type="hidden" name="tok" value="${token}" />
          <input type="hidden" name="partID" value="${partId}" />
          <input type="hidden" name="fmt" value="zip" />
          <input type="hidden" name="lang" value="en-GB" />
          <input type="hidden" name="datasheet" value="" />
          <input type="hidden" name="emb" value="1" />
          <input type="hidden" name="pna" value="Mouser" />
        </form>
      </body>
    </html>
  `;
}

const MOUZER_SYMBOL = `(kicad_symbol_lib (version 20211014) (generator SamacSys_ECAD_Model)
  (symbol "STM32C552KEU6" (in_bom yes) (on_board yes)
    (property "Reference" "IC" (at 0 0 0))
    (property "Value" "STM32C552KEU6" (at 0 -2.54 0))
    (property "Footprint" "QFN50P500X500X60-33N-D" (at 0 -5.08 0))
  )
)
`;

const MOUSER_FOOTPRINT = `(module "QFN50P500X500X60-33N-D" (layer F.Cu)
  (fp_text reference IC** (at 0 0) (layer F.SilkS))
  (model STM32C552KEU6.stp
    (at (xyz 0 0 0))
    (scale (xyz 1 1 1))
    (rotate (xyz 0 0 0))
  )
)
`;

describe("service worker", () => {
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
    expect(filenames).toContain("KiCad/Workspace/QFN-16_Example-datasheet.pdf");

    listeners.downloadsChanged[0]({
      id: 1,
      state: { current: "complete" }
    });
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("returns Mouser PNG preview URLs by resolving the SamacSys part page", async () => {
    const { chrome, listeners } = createServiceWorkerChrome();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (String(url).includes("preview_newDesign.php")) {
        return {
          ok: true,
          url: String(url),
          text: async () => createMouserPartHtml()
        };
      }
      if (String(url).includes("symbol.php")) {
        return {
          ok: true,
          json: async () => ({ Image: "AAAA" })
        };
      }
      if (String(url).includes("footprint.php")) {
        return {
          ok: true,
          json: async () => ({ Image: "BBBB" })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createMouserPartContext()
    });

    expect(result.response).toEqual({
      ok: true,
      previews: {
        symbolUrl: "data:image/png;base64,AAAA",
        footprintUrl: "data:image/png;base64,BBBB"
      },
      metadata: {
        datasheetAvailable: false
      }
    });
  });

  it("exports Mouser loose-file downloads and warns when the WRL endpoint is missing", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      },
      {
        name: "STM32C552KEU6/KiCad/QFN50P500X500X60-33N-D.kicad_mod",
        data: new TextEncoder().encode(MOUSER_FOOTPRINT)
      },
      {
        name: "STM32C552KEU6/3D/STM32C552KEU6.stp",
        data: new TextEncoder().encode("step")
      }
    ]);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (String(url).includes("preview_newDesign.php")) {
        expect(options.credentials).toBe("include");
        return {
          ok: true,
          url: String(url),
          text: async () => createMouserPartHtml()
        };
      }
      if (String(url).includes("/ga/model.php")) {
        expect(options.method).toBe("GET");
        expect(options.credentials).toBe("include");
        expect(String(url)).toContain("tok=tok123");
        expect(String(url)).toContain("partID=21790508");
        expect(String(url)).toContain("fmt=zip");
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("PKzip").buffer
        };
      }
      if (String(url).includes("/3D/0/21790508.wrl")) {
        return {
          ok: false,
          status: 404
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createMouserPartContext(),
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: ["SamacSys WRL model not available for this part."],
      downloadCount: 3
    });

    const filenames = chrome.downloads.download.mock.calls.map(
      ([options]) => options.filename
    );
    expect(filenames).toContain("STM32C552KEU6.kicad_sym");
    expect(filenames).toContain("QFN50P500X500X60-33N-D.kicad_mod");
    expect(filenames).toContain("STM32C552KEU6.stp");
  });

  it("exports Mouser library downloads and rewrites symbol and footprint references", async () => {
    const { chrome, listeners, storage } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: false,
        libraryDownloadRoot: "KiCad/Workspace",
        "symbolLibrary:KiCad/Workspace/Workspace.kicad_sym":
          createSymbolLibrary()
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      },
      {
        name: "STM32C552KEU6/KiCad/QFN50P500X500X60-33N-D.kicad_mod",
        data: new TextEncoder().encode(MOUSER_FOOTPRINT)
      },
      {
        name: "STM32C552KEU6/3D/STM32C552KEU6.stp",
        data: new TextEncoder().encode("step")
      }
    ]);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (String(url).includes("preview_newDesign.php")) {
        expect(options.credentials).toBe("include");
        return {
          ok: true,
          url: String(url),
          text: async () => createMouserPartHtml()
        };
      }
      if (String(url).includes("/ga/model.php")) {
        expect(options.method).toBe("GET");
        expect(options.credentials).toBe("include");
        expect(String(url)).toContain("tok=tok123");
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("PKzip").buffer
        };
      }
      if (String(url).includes("/3D/0/21790508.wrl")) {
        return {
          ok: true,
          text: async () => "#VRML V2.0"
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createMouserPartContext(),
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 4
    });

    expect(storage["symbolLibrary:KiCad/Workspace/Workspace.kicad_sym"]).toContain(
      'Workspace:QFN50P500X500X60-33N-D'
    );

    const downloadCalls = chrome.downloads.download.mock.calls.map(([options]) => options);
    const footprintCall = downloadCalls.find((options) =>
      options.filename.endsWith("Workspace.pretty/QFN50P500X500X60-33N-D.kicad_mod")
    );
    expect(footprintCall.url).toContain("blob:");

    const filenames = downloadCalls.map((options) => options.filename);
    expect(filenames).toContain("KiCad/Workspace/Workspace.kicad_sym");
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.pretty/QFN50P500X500X60-33N-D.kicad_mod"
    );
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.3dshapes/STM32C552KEU6.stp"
    );
    expect(filenames).toContain(
      "KiCad/Workspace/Workspace.3dshapes/STM32C552KEU6.wrl"
    );
  });

  it("does not leave Mouser footprint model references behind when 3D export is disabled", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: false,
        libraryDownloadRoot: "KiCad/Workspace"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/QFN50P500X500X60-33N-D.kicad_mod",
        data: new TextEncoder().encode(MOUSER_FOOTPRINT)
      },
      {
        name: "STM32C552KEU6/3D/STM32C552KEU6.stp",
        data: new TextEncoder().encode("step")
      }
    ]);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (String(url).includes("preview_newDesign.php")) {
        expect(options.credentials).toBe("include");
        return {
          ok: true,
          url: String(url),
          text: async () => createMouserPartHtml()
        };
      }
      if (String(url).includes("/ga/model.php")) {
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("PKzip").buffer
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { hooks } = loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    expect(hooks.stripKicadFootprintModels(MOUSER_FOOTPRINT)).not.toContain(
      "(model"
    );
    expect(hooks.stripKicadFootprintModels(MOUSER_FOOTPRINT)).not.toContain(
      "STM32C552KEU6.stp"
    );

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createMouserPartContext(),
      options: {
        symbol: false,
        footprint: true,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1
    });

    const filenames = chrome.downloads.download.mock.calls.map(
      ([options]) => options.filename
    );
    expect(filenames).toEqual([
      "KiCad/Workspace/Workspace.pretty/QFN50P500X500X60-33N-D.kicad_mod"
    ]);
  });

  it("returns a sign-in-required error when Mouser ZIP export is unauthorized", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace"
      }
    });
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (String(url).includes("preview_newDesign.php")) {
        expect(options.credentials).toBe("include");
        return {
          ok: true,
          url: String(url),
          text: async () => createMouserPartHtml()
        };
      }
      if (String(url).includes("/ga/model.php")) {
        return {
          ok: false,
          status: 401
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createMouserPartContext(),
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: false,
      error:
        "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded."
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it("returns structured unsupported responses for Mouser requests on Firefox", async () => {
    const { chrome, listeners } = createServiceWorkerChrome();
    const fetchImpl = vi.fn();
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const previewResult = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createMouserPartContext()
    });
    const exportResult = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createMouserPartContext(),
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });

    expect(previewResult.response).toEqual({
      ok: false,
      error: "Mouser/SamacSys downloads require a proxy in Firefox. Chrome-only for now."
    });
    expect(exportResult.response).toEqual({
      ok: false,
      error: "Mouser/SamacSys downloads require a proxy in Firefox. Chrome-only for now."
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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
