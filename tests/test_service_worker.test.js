import { describe, expect, it, vi } from "vitest";

import { createCadData, createSymbolLibrary } from "./helpers/fixtures.js";
import { flushAsyncWork } from "./helpers/test_harness.js";
import {
  buildLibraryPaths,
  loadSettings,
  normalizeLibraryDownloadRoot,
  parseSamacsysCapturedAuthorizationCapturedAt,
  parseSamacsysAuthorizationHeader,
  parseSamacsysProxyAuthorizationHeader,
  parseSamacsysFirefoxProxyBaseUrl
} from "../src/core/settings.js";
import {
  extractSymbolBlock,
  mergeSymbolIntoLibrary
} from "../src/core/library_store.js";
import { registerServiceWorkerRuntime } from "../src/service_worker_runtime.js";
import {
  parseSamacsysPageMetadata,
  rewriteSamacsysFootprintModelPath,
  rewriteSamacsysSymbolFootprintReference,
  stripKicadFootprintModels
} from "../src/sources/samacsys_common.js";

function createServiceWorkerChrome({ storageState = {}, cookieState = {} } = {}) {
  const listeners = {
    runtimeMessage: [],
    downloadsChanged: [],
    beforeSendHeaders: []
  };
  const storage = { ...storageState };
  const cookieJar = { ...cookieState };
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
    webRequest: {
      onBeforeSendHeaders: {
        addListener(listener) {
          listeners.beforeSendHeaders.push(listener);
        }
      }
    },
    tabs: {
      sendMessage: vi.fn((tabId, message, callback) => {
        callback?.({ ok: true });
      })
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
    cookies: {
      getAll: vi.fn(({ url }, callback) => {
        callback(cookieJar[url] || cookieJar["*"] || []);
      })
    }
  };

  return { chrome, listeners, storage };
}

function createMockUrlApi() {
  class MockURL extends URL {}
  MockURL.createObjectURL = vi.fn(() => "blob:download");
  MockURL.revokeObjectURL = vi.fn();
  return MockURL;
}

function loadServiceWorker({
  chrome,
  fetchImpl,
  userAgent = "Mozilla/5.0 Chrome/135.0.0.0",
  samacsysAuthRefreshTimeoutMs,
  convertEasyedaCadToKicad = vi.fn(() => ({})),
  convertObjToWrlString = vi.fn(() => "#VRML"),
  readZipEntries = vi.fn(async () => []),
  urlApi = createMockUrlApi()
}) {
  registerServiceWorkerRuntime(chrome, {
    fetchImpl,
    userAgent,
    samacsysAuthRefreshTimeoutMs,
    convertEasyedaCadToKicad,
    convertObjToWrlString,
    readZipEntries,
    urlApi,
    blobCtor: Blob
  });

  return { urlApi };
}

function sendRuntimeMessage(listener, message) {
  return new Promise((resolve) => {
    const handled = listener(message, null, (response) => resolve({ handled, response }));
    if (handled === false) {
      resolve({ handled, response: undefined });
    }
  });
}

function emitBeforeSendHeaders(listener, details) {
  return listener(details);
}

function createSamacsysPartContext(distributor, overrides = {}) {
  const fixtures = {
    mouser: {
      provider: "mouserSamacsys",
      sourcePartLabel: "Mouser part",
      sourcePartNumber: "511-STM32U3C5RIT6Q",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      lookup: {
        manufacturerName: "STMicroelectronics",
        entryUrl:
          "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB",
        partnerName: "mouser",
        samacsysBaseUrl: "https://ms.componentsearchengine.com"
      }
    },
    farnell: {
      provider: "farnellSamacsys",
      sourcePartLabel: "Farnell part",
      sourcePartNumber: "1848693",
      manufacturerPartNumber: "FQP27P06",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=FQP27P06&pna=farnell&vrq=multi&fmt=zip&lang=en-GB",
        authRefreshUrl:
          "https://farnell.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=FQP27P06&pna=farnell&logo=farnell&q3=SHOW3D",
        partnerName: "farnell",
        samacsysBaseUrl: "https://farnell.componentsearchengine.com"
      }
    }
  };
  const fixture = fixtures[distributor];
  return {
    ...fixture,
    ...overrides,
    lookup: {
      ...fixture.lookup,
      ...overrides.lookup
    }
  };
}

function createSamacsysPartHtml({
  token = "tok123",
  partId = "21790508",
  zipActionUrl = "https://ms.componentsearchengine.com/ga/model.php"
} = {}) {
  return `
    <html>
      <body>
        <form id="zipForm" action="${zipActionUrl}" method="GET">
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

function createMockHeaders(entries = {}) {
  return {
    get(name) {
      const match = Object.entries(entries).find(
        ([key]) => key.toLowerCase() === String(name || "").toLowerCase()
      );
      return match ? match[1] : null;
    }
  };
}

function createDirectSamacsysZipFetchImpl({
  baseUrl = "https://ms.componentsearchengine.com",
  partId = "21790508",
  zipStatuses = [200],
  expectedZipAuthorizationHeaders = []
} = {}) {
  const zipCalls = [];

  const fetchImpl = vi.fn(async (url, options = {}) => {
    const requestUrl = String(url);

    if (requestUrl.includes("entry_u_newDesign.php")) {
      expect(options.headers?.Authorization).toBeUndefined();
      return {
        ok: true,
        status: 200,
        url: `${baseUrl}/part.php?partID=${partId}`,
        headers: createMockHeaders(),
        text: async () => "<html><body>entry ok</body></html>"
      };
    }

    if (requestUrl.includes("preview_newDesign.php")) {
      expect(options.credentials).toBe("include");
      expect(options.headers?.Authorization).toBeUndefined();
      return {
        ok: true,
        status: 200,
        url: requestUrl,
        headers: createMockHeaders(),
        text: async () =>
          createSamacsysPartHtml({
            partId,
            zipActionUrl: `${baseUrl}/ga/model.php`
          })
      };
    }

    if (requestUrl.includes("/ga/model.php")) {
      expect(options.credentials).toBe("include");
      const authorizationHeader =
        options.headers?.Authorization || options.headers?.authorization || "";
      zipCalls.push({ url: requestUrl, authorizationHeader });
      const attemptIndex = zipCalls.length - 1;
      if (expectedZipAuthorizationHeaders[attemptIndex] !== undefined) {
        expect(authorizationHeader).toBe(expectedZipAuthorizationHeaders[attemptIndex]);
      }
      const status = zipStatuses[Math.min(attemptIndex, zipStatuses.length - 1)];
      if (status === 200) {
        return {
          ok: true,
          status: 200,
          headers: createMockHeaders(),
          arrayBuffer: async () => new TextEncoder().encode("PKzip").buffer
        };
      }
      return {
        ok: false,
        status,
        headers: createMockHeaders()
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  });

  fetchImpl.getZipCalls = () => zipCalls.slice();
  return fetchImpl;
}

function createSamacsysFetchImpl({
  baseUrl = "https://ms.componentsearchengine.com",
  proxyBaseUrl = "",
  partId = "21790508",
  symbolImage,
  footprintImage,
  zipStatus,
  zipPayload = "PKzip",
  wrlStatus,
  wrlText = "#VRML V2.0",
  proxyFailureMessage = "",
  expectedProxyAuthorizationHeader,
  expectedCookieHeader = "",
  expectedAuthorizationHeader = "",
  expectedNoForwardAuthorizationHeader = false
} = {}) {
  function createProxyResponse(url, response) {
    return {
      ok: response.ok,
      status: response.status,
      headers: createMockHeaders({
        "x-upstream-url": response.url || url
      }),
      text: response.text,
      json: response.json,
      arrayBuffer: response.arrayBuffer
    };
  }

  return vi.fn(async (url, options = {}) => {
    const requestUrl = String(url);
    if (proxyBaseUrl && requestUrl === proxyBaseUrl) {
      if (proxyFailureMessage) {
        throw new Error(proxyFailureMessage);
      }
      const proxyRequest = JSON.parse(options.body);
      expect(options.method).toBe("POST");
      expect(proxyRequest.url).toBeTruthy();
      if (expectedProxyAuthorizationHeader !== undefined) {
        expect(options.headers.Authorization || "").toBe(
          expectedProxyAuthorizationHeader
        );
      }
      const upstreamOptions = {
        credentials: proxyRequest.credentials,
        headers: proxyRequest.headers,
        method: proxyRequest.method
      };
      if (expectedCookieHeader) {
        expect(proxyRequest.headers.Cookie).toBe(expectedCookieHeader);
      }
      if (expectedAuthorizationHeader) {
        expect(proxyRequest.headers.Authorization).toBe(
          expectedAuthorizationHeader
        );
      } else if (expectedNoForwardAuthorizationHeader) {
        expect(proxyRequest.headers.Authorization).toBeUndefined();
      }
      if (proxyRequest.bodyText !== null) {
        upstreamOptions.body = proxyRequest.bodyText;
      }
      if (proxyRequest.bodyBase64) {
        upstreamOptions.body = Uint8Array.from(
          Buffer.from(proxyRequest.bodyBase64, "base64")
        );
      }
      return createProxyResponse(
        proxyRequest.url,
        await createSamacsysFetchImpl({
          baseUrl,
          partId,
          symbolImage,
          footprintImage,
          zipStatus,
          zipPayload,
          wrlStatus,
          wrlText
        })(proxyRequest.url, upstreamOptions)
      );
    }
    if (requestUrl.includes("entry_u_newDesign.php")) {
      return {
        ok: true,
        status: 200,
        url: `${baseUrl}/part.php?partID=${partId}`,
        headers: createMockHeaders(),
        text: async () => "<html><body>entry ok</body></html>"
      };
    }
    if (requestUrl.includes("preview_newDesign.php")) {
      expect(options.credentials).toBe("include");
      return {
        ok: true,
        status: 200,
        url: requestUrl,
        headers: createMockHeaders(),
        text: async () =>
          createSamacsysPartHtml({
            partId,
            zipActionUrl: `${baseUrl}/ga/model.php`
          })
      };
    }
    if (requestUrl.includes("/symbol.php") && symbolImage !== undefined) {
      return {
        ok: true,
        status: 200,
          headers: createMockHeaders(),
          json: async () => ({ Image: symbolImage })
        };
    }
    if (requestUrl.includes("/footprint.php") && footprintImage !== undefined) {
      return {
        ok: true,
        status: 200,
          headers: createMockHeaders(),
          json: async () => ({ Image: footprintImage })
        };
    }
    if (requestUrl.includes("/ga/model.php") && zipStatus !== undefined) {
      expect(options.credentials).toBe("include");
      if (zipStatus === 200) {
        return {
          ok: true,
          status: 200,
          headers: createMockHeaders(),
          arrayBuffer: async () => new TextEncoder().encode(zipPayload).buffer
        };
      }
      return {
        ok: false,
        status: zipStatus
      };
    }
    if (requestUrl.includes(`/3D/0/${partId}.wrl`) && wrlStatus !== undefined) {
      if (wrlStatus === 200) {
        return {
          ok: true,
          status: 200,
          headers: createMockHeaders(),
          text: async () => wrlText
        };
      }
      return {
        ok: false,
        status: wrlStatus
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
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
  it("normalizes library roots and builds KiCad library paths", () => {
    expect(normalizeLibraryDownloadRoot("KiCad\\Workspace")).toBe("KiCad/Workspace");
    expect(normalizeLibraryDownloadRoot("../outside")).toBe("easyEDADownloader");
    expect(parseSamacsysFirefoxProxyBaseUrl(" https://proxy.example.test/relay#frag ")).toEqual({
      value: "https://proxy.example.test/relay",
      isValid: true
    });
    expect(parseSamacsysFirefoxProxyBaseUrl("not-a-url")).toEqual({
      value: "",
      isValid: false
    });
    expect(
      parseSamacsysProxyAuthorizationHeader(" Authorization: Bearer relay123 ")
    ).toBe("Bearer relay123");
    expect(parseSamacsysAuthorizationHeader(" Authorization: Basic abc123 ")).toBe(
      "Basic abc123"
    );
    expect(
      parseSamacsysCapturedAuthorizationCapturedAt(
        "2026-04-14T11:40:00.000Z"
      )
    ).toBe("2026-04-14T11:40:00.000Z");
    expect(buildLibraryPaths("KiCad/Workspace")).toEqual({
      symbolFile: "KiCad/Workspace/Workspace.kicad_sym",
      footprintDir: "KiCad/Workspace/Workspace.pretty",
      modelDir: "KiCad/Workspace/Workspace.3dshapes"
    });
  });

  it("loads the optional Firefox SamacSys proxy setting from storage", async () => {
    const { chrome } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxProxyAuthorizationHeader: "Authorization: Bearer proxy123",
        samacsysFirefoxAuthorizationHeader: "Authorization: Basic abc123",
        samacsysFirefoxCapturedAuthorizationHeader: "Authorization: Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt: "2026-04-14T11:40:00.000Z"
      }
    });

    await expect(loadSettings(chrome)).resolves.toEqual({
      downloadIndividually: false,
      libraryDownloadRoot: "easyEDADownloader",
      samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
      samacsysFirefoxProxyAuthorizationHeader: "Bearer proxy123",
      samacsysFirefoxUsername: "",
      samacsysFirefoxPassword: "",
      samacsysFirefoxAuthorizationHeader: "Basic abc123",
      samacsysFirefoxCapturedAuthorizationHeader: "Basic captured123",
      samacsysFirefoxCapturedAuthorizationCapturedAt: "2026-04-14T11:40:00.000Z"
    });
  });

  it("captures and persists the latest Firefox SamacSys Authorization header", async () => {
    const { chrome, listeners, storage } = createServiceWorkerChrome();
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(),
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    expect(listeners.beforeSendHeaders).toHaveLength(1);

    emitBeforeSendHeaders(listeners.beforeSendHeaders[0], {
      requestHeaders: [
        {
          name: "Authorization",
          value: "Basic captured-from-browser"
        }
      ]
    });

    expect(storage.samacsysFirefoxCapturedAuthorizationHeader).toBe(
      "Basic captured-from-browser"
    );
    expect(storage.samacsysFirefoxCapturedAuthorizationCapturedAt).toMatch(
      /^20\d\d-\d\d-\d\dT/
    );
  });

  it("refreshes SamacSys auth by triggering the page-native auth flow on the source tab", async () => {
    const { chrome, listeners, storage } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(),
      userAgent: "Mozilla/5.0 Firefox/149.0",
      samacsysAuthRefreshTimeoutMs: 100
    });

    const refreshPromise = sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "REFRESH_SAMACSYS_AUTH",
      partContext: createSamacsysPartContext("mouser"),
      sourceTabId: 7
    });
    await flushAsyncWork();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      {
        type: "TRIGGER_SAMACSYS_AUTH",
        partContext: createSamacsysPartContext("mouser")
      },
      expect.any(Function)
    );

    emitBeforeSendHeaders(listeners.beforeSendHeaders[0], {
      requestHeaders: [
        {
          name: "Authorization",
          value: "Basic refreshed123"
        }
      ]
    });

    const result = await refreshPromise;
    expect(result.response).toEqual({
      ok: true,
      authorizationHeader: "Basic refreshed123",
      capturedAt: storage.samacsysFirefoxCapturedAuthorizationCapturedAt
    });
  });

  it("fails SamacSys auth refresh when the page-native auth trigger is unavailable", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    chrome.tabs.sendMessage.mockImplementation((_tabId, _message, callback) => {
      callback?.({
        ok: false,
        error: "SamacSys auth trigger was not found on the current page."
      });
    });
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(),
      userAgent: "Mozilla/5.0 Firefox/149.0",
      samacsysAuthRefreshTimeoutMs: 100
    });

    const refreshPromise = sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "REFRESH_SAMACSYS_AUTH",
      partContext: createSamacsysPartContext("mouser"),
      sourceTabId: 7
    });
    await flushAsyncWork();

    const result = await refreshPromise;
    expect(result.response).toEqual({
      ok: false,
      error: "SamacSys auth trigger was not found on the current page."
    });
  });

  it("triggers the current Farnell page instead of opening a separate auth tab", async () => {
    const { chrome, listeners, storage } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    loadServiceWorker({
      chrome,
      fetchImpl: vi.fn(),
      userAgent: "Mozilla/5.0 Firefox/149.0",
      samacsysAuthRefreshTimeoutMs: 100
    });

    const refreshPromise = sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "REFRESH_SAMACSYS_AUTH",
      partContext: createSamacsysPartContext("farnell"),
      sourceTabId: 9
    });
    await flushAsyncWork();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      9,
      {
        type: "TRIGGER_SAMACSYS_AUTH",
        partContext: createSamacsysPartContext("farnell")
      },
      expect.any(Function)
    );

    emitBeforeSendHeaders(listeners.beforeSendHeaders[0], {
      requestHeaders: [
        {
          name: "Authorization",
          value: "Basic refreshed123"
        }
      ]
    });

    const result = await refreshPromise;
    expect(result.response).toEqual({
      ok: true,
      authorizationHeader: "Basic refreshed123",
      capturedAt: storage.samacsysFirefoxCapturedAuthorizationCapturedAt
    });
  });

  it("merges symbol blocks without duplicating existing ids", () => {
    const symbolBlock = extractSymbolBlock(MOUZER_SYMBOL);
    const merged = mergeSymbolIntoLibrary(createSymbolLibrary(), symbolBlock, "STM32C552KEU6");

    expect(symbolBlock).toContain('(symbol "STM32C552KEU6"');
    expect(merged).toContain('(symbol "ExistingSymbol"');
    expect(merged).toContain('(symbol "STM32C552KEU6"');
    expect(mergeSymbolIntoLibrary(merged, symbolBlock, "STM32C552KEU6")).toBe(merged);
  });

  it("rewrites Mouser symbol and footprint library references", () => {
    expect(
      rewriteSamacsysSymbolFootprintReference(
        MOUZER_SYMBOL,
        "QFN50P500X500X60-33N-D",
        "Workspace"
      )
    ).toContain('Workspace:QFN50P500X500X60-33N-D');
    expect(
      rewriteSamacsysFootprintModelPath(
        MOUSER_FOOTPRINT,
        "STM32C552KEU6.stp",
        "Workspace"
      )
    ).toContain("../Workspace.3dshapes/STM32C552KEU6.stp");
    expect(stripKicadFootprintModels(MOUSER_FOOTPRINT)).not.toContain("(model");
  });

  it("parses the SamacSys ZIP form metadata from the part page", () => {
    expect(
      parseSamacsysPageMetadata(
        createSamacsysPartHtml(),
        "https://ms.componentsearchengine.com/part.php?partID=21790508",
        "https://ms.componentsearchengine.com"
      )
    ).toEqual({
      partId: "21790508",
      token: "tok123",
      pageUrl: "https://ms.componentsearchengine.com/part.php?partID=21790508",
      baseUrl: "https://ms.componentsearchengine.com",
      zipActionUrl: "https://ms.componentsearchengine.com/ga/model.php",
      zipMethod: "GET",
      zipFormInputs: {
        partner: "Mouser",
        tok: "tok123",
        partID: "21790508",
        fmt: "zip",
        lang: "en-GB",
        datasheet: "",
        emb: "1",
        pna: "Mouser"
      }
    });
  });

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
    const fetchImpl = createSamacsysFetchImpl({
      symbolImage: "AAAA",
      footprintImage: "BBBB"
    });
    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
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

  it("routes Farnell previews through the shared SamacSys host from part context", async () => {
    const { chrome, listeners } = createServiceWorkerChrome();
    const fetchImpl = createSamacsysFetchImpl({
      baseUrl: "https://farnell.componentsearchengine.com",
      partId: "9988",
      symbolImage: "CCCC",
      footprintImage: "DDDD"
    });
    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("farnell")
    });

    expect(result.response).toEqual({
      ok: true,
      previews: {
        symbolUrl: "data:image/png;base64,CCCC",
        footprintUrl: "data:image/png;base64,DDDD"
      },
      metadata: {
        datasheetAvailable: false
      }
    });
  });

  it("exports Mouser loose-file downloads without probing a missing WRL endpoint", async () => {
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
    const fetchImpl = createSamacsysFetchImpl({
      zipStatus: 200
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
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
      },
      {
        name: "STM32C552KEU6/3D/STM32C552KEU6.wrl",
        data: new TextEncoder().encode("#VRML V2.0")
      }
    ]);
    const fetchImpl = createSamacsysFetchImpl({
      zipStatus: 200
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
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
    const fetchImpl = createSamacsysFetchImpl({
      zipStatus: 200
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries
    });

    expect(stripKicadFootprintModels(MOUSER_FOOTPRINT)).not.toContain("(model");
    expect(stripKicadFootprintModels(MOUSER_FOOTPRINT)).not.toContain(
      "STM32C552KEU6.stp"
    );

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
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
    const fetchImpl = createSamacsysFetchImpl({
      zipStatus: 401
    });

    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
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

  it("retries Firefox SamacSys export once after automatically refreshing auth", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace",
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      }
    ]);
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl === "https://proxy.example.test/relay") {
        const proxyRequest = JSON.parse(options.body);
        if (proxyRequest.url.includes("entry_u_newDesign.php")) {
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                return String(name).toLowerCase() === "x-upstream-url"
                  ? "https://ms.componentsearchengine.com/part.php?partID=21790508"
                  : null;
              }
            },
            text: async () => "<html><body>entry ok</body></html>"
          };
        }
        if (proxyRequest.url.includes("preview_newDesign.php")) {
          return {
            ok: true,
            status: 200,
            headers: {
              get() {
                return null;
              }
            },
            text: async () => createSamacsysPartHtml()
          };
        }
        if (proxyRequest.url.includes("/ga/model.php")) {
          if (proxyRequest.headers.Authorization === "Basic refreshed123") {
            return {
              ok: true,
              status: 200,
              headers: {
                get() {
                  return null;
                }
              },
              arrayBuffer: async () => new TextEncoder().encode("PKzip").buffer
            };
          }
          return {
            ok: false,
            status: 401,
            headers: {
              get() {
                return null;
              }
            }
          };
        }
        if (proxyRequest.url.includes("/3D/0/21790508.wrl")) {
          return {
            ok: false,
            status: 404,
            headers: {
              get() {
                return null;
              }
            }
          };
        }
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Firefox/149.0",
      samacsysAuthRefreshTimeoutMs: 100
    });

    const exportPromise = sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      sourceTabId: 7,
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });
    await vi.waitFor(() => {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    emitBeforeSendHeaders(listeners.beforeSendHeaders[0], {
      requestHeaders: [
        {
          name: "Authorization",
          value: "Basic refreshed123"
        }
      ]
    });

    const result = await exportPromise;
    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1,
      authRefreshed: true,
      authAuthorizationHeader: "Basic refreshed123",
      authCapturedAt: expect.any(String)
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      {
        type: "TRIGGER_SAMACSYS_AUTH",
        partContext: createSamacsysPartContext("mouser")
      },
      expect.any(Function)
    );
  });

  it("stops after one refreshed retry when Firefox SamacSys export still returns unauthorized", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace",
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      zipStatus: 401
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0",
      samacsysAuthRefreshTimeoutMs: 100
    });

    const exportPromise = sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      sourceTabId: 7,
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });
    await vi.waitFor(() => {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    emitBeforeSendHeaders(listeners.beforeSendHeaders[0], {
      requestHeaders: [
        {
          name: "Authorization",
          value: "Basic refreshed123"
        }
      ]
    });

    const result = await exportPromise;
    expect(result.response).toEqual({
      ok: false,
      error:
        "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded."
    });
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
      partContext: createSamacsysPartContext("mouser")
    });
    const exportResult = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: true,
        model3d: true,
        datasheet: false
      }
    });

    expect(previewResult.response).toEqual({
      ok: false,
      error: "SamacSys distributor downloads require a proxy in Firefox. Chrome-only for now."
    });
    expect(exportResult.response).toEqual({
      ok: false,
      error: "SamacSys distributor downloads require a proxy in Firefox. Chrome-only for now."
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows Firefox SamacSys previews through the configured proxy relay", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      symbolImage: "AAAA",
      footprintImage: "BBBB",
      expectedProxyAuthorizationHeader: "",
      expectedNoForwardAuthorizationHeader: true
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
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
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://proxy.example.test/relay",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("forwards SamacSys cookies through the Firefox proxy relay", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxProxyAuthorizationHeader: "Bearer relay-secret",
        samacsysFirefoxAuthorizationHeader: "Basic abc123"
      },
      cookieState: {
        "*": [
          { name: "PHPSESSID", value: "relay-session" },
          { name: "partner", value: "mouser" }
        ]
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      symbolImage: "AAAA",
      footprintImage: "BBBB",
      expectedProxyAuthorizationHeader: "Bearer relay-secret",
      expectedCookieHeader: "PHPSESSID=relay-session; partner=mouser",
      expectedAuthorizationHeader: "Basic abc123"
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
    expect(chrome.cookies.getAll).toHaveBeenCalled();
  });

  it("uses the captured SamacSys Authorization header when no manual override exists", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxCapturedAuthorizationHeader: "Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt:
          "2026-04-14T11:40:00.000Z"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      symbolImage: "AAAA",
      footprintImage: "BBBB",
      expectedAuthorizationHeader: "Basic captured123"
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
  });

  it("builds the SamacSys Authorization header from stored credentials when no manual override exists", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123",
        samacsysFirefoxCapturedAuthorizationHeader: "Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt:
          "2026-04-14T11:40:00.000Z"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      symbolImage: "AAAA",
      footprintImage: "BBBB",
      expectedAuthorizationHeader: "Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQxMjM="
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
  });

  it("prefers the manual SamacSys Authorization override over the captured header", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay",
        samacsysFirefoxAuthorizationHeader: "Basic manual123",
        samacsysFirefoxCapturedAuthorizationHeader: "Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt:
          "2026-04-14T11:40:00.000Z"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      symbolImage: "AAAA",
      footprintImage: "BBBB",
      expectedAuthorizationHeader: "Basic manual123"
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
  });

  it("allows Firefox SamacSys export through the configured proxy relay", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        libraryDownloadRoot: "KiCad/Workspace",
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
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
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      zipStatus: 200
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
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
      downloadCount: 3
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://proxy.example.test/relay",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("does not read SamacSys cookies on Chrome direct requests", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      cookieState: {
        "*": [{ name: "PHPSESSID", value: "direct-session" }]
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      symbolImage: "AAAA",
      footprintImage: "BBBB"
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
  });

  it("does not attach upstream auth to Chrome direct preview requests", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxAuthorizationHeader: "Basic manual123",
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123"
      }
    });
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      expect(options.headers?.Authorization).toBeUndefined();
      if (requestUrl.includes("entry_u_newDesign.php")) {
        return {
          ok: true,
          status: 200,
          url: "https://ms.componentsearchengine.com/part.php?partID=21790508",
          headers: createMockHeaders(),
          text: async () => "<html><body>entry ok</body></html>"
        };
      }
      if (requestUrl.includes("preview_newDesign.php")) {
        return {
          ok: true,
          status: 200,
          url: requestUrl,
          headers: createMockHeaders(),
          text: async () =>
            createSamacsysPartHtml({
              partId: "21790508",
              zipActionUrl: "https://ms.componentsearchengine.com/ga/model.php"
            })
        };
      }
      if (requestUrl.includes("/symbol.php")) {
        return {
          ok: true,
          status: 200,
          headers: createMockHeaders(),
          json: async () => ({ Image: "AAAA" })
        };
      }
      if (requestUrl.includes("/footprint.php")) {
        return {
          ok: true,
          status: 200,
          headers: createMockHeaders(),
          json: async () => ({ Image: "BBBB" })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response.ok).toBe(true);
  });

  it("does not preemptively attach configured SamacSys auth on Chrome ZIP exports", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxAuthorizationHeader: "Basic manual123"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      }
    ]);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [200],
      expectedZipAuthorizationHeaders: [""]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(1);
  });

  it("retries one Chrome SamacSys ZIP request with the manual override after a 401", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxAuthorizationHeader: "Basic manual123"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      }
    ]);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401, 200],
      expectedZipAuthorizationHeaders: ["", "Basic manual123"]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(2);
  });

  it("retries one Chrome SamacSys ZIP request with generated Basic auth after a 401", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      }
    ]);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401, 200],
      expectedZipAuthorizationHeaders: [
        "",
        "Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQxMjM="
      ]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(2);
  });

  it("uses a stored captured SamacSys header for the Chrome ZIP retry when one exists", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxCapturedAuthorizationHeader: "Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt:
          "2026-04-14T11:40:00.000Z"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUZER_SYMBOL)
      }
    ]);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401, 200],
      expectedZipAuthorizationHeaders: ["", "Basic captured123"]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [],
      downloadCount: 1
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(2);
  });

  it("returns the sign-in-required error after one Chrome 401 when no retry auth is configured", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true
      }
    });
    const readZipEntries = vi.fn(async () => []);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401],
      expectedZipAuthorizationHeaders: [""]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: false,
      error:
        "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded."
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(1);
  });

  it("stops after one authenticated Chrome retry when the SamacSys ZIP still returns 401", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxAuthorizationHeader: "Basic manual123"
      }
    });
    const readZipEntries = vi.fn(async () => []);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401, 401],
      expectedZipAuthorizationHeaders: ["", "Basic manual123"]
    });

    loadServiceWorker({
      chrome,
      fetchImpl,
      readZipEntries,
      userAgent: "Mozilla/5.0 Chrome/135.0.0.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: true,
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: false,
      error:
        "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded."
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(2);
  });

  it("surfaces proxy transport failures distinctly from upstream SamacSys errors", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        samacsysFirefoxProxyBaseUrl: "https://proxy.example.test/relay"
      }
    });
    const fetchImpl = createSamacsysFetchImpl({
      proxyBaseUrl: "https://proxy.example.test/relay",
      proxyFailureMessage: "socket hang up"
    });
    loadServiceWorker({
      chrome,
      fetchImpl,
      userAgent: "Mozilla/5.0 Firefox/149.0"
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "GET_PART_PREVIEWS",
      partContext: createSamacsysPartContext("mouser")
    });

    expect(result.response).toEqual({
      ok: false,
      error: "SamacSys proxy request failed: socket hang up"
    });
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
