/*
 * These tests cover service-worker settings, download wrappers, auth-capture
 * plumbing, and SamacSys archive helper behavior.
 */

import { describe, expect, it, vi } from "vitest";

import { createSymbolLibrary } from "./helpers/fixtures.js";
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
import { createDownloadApi } from "../src/core/downloads.js";
import {
  extractSamacsysKiCadAssets,
  parseSamacsysPageMetadata,
  rewriteSamacsysFootprintModelPath,
  rewriteSamacsysSymbolFootprintReference,
  stripKicadFootprintModels
} from "../src/sources/samacsys_common.js";
import {
  createSamacsysPartContext,
  createSamacsysPartHtml,
  createServiceWorkerChrome,
  emitBeforeSendHeaders,
  loadServiceWorker,
  MOUSER_FOOTPRINT,
  MOUSER_SYMBOL,
  sendRuntimeMessage
} from "./helpers/service_worker_harness.js";

describe("service worker core helpers", () => {
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
    expect(parseSamacsysAuthorizationHeader("Basic abc123\r\nX-Injected: yes")).toBe(
      ""
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
        rememberSamacsysFirefoxProxyAuthorizationHeader: true
      },
      sessionStorageState: {
        samacsysFirefoxCapturedAuthorizationHeader: "Authorization: Basic captured123",
        samacsysFirefoxCapturedAuthorizationCapturedAt: new Date().toISOString()
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
      samacsysFirefoxCapturedAuthorizationCapturedAt: expect.any(String),
      rememberSamacsysCredentials: false,
      rememberSamacsysFirefoxProxyAuthorizationHeader: true
    });
  });

  it("ignores expired Firefox-captured SamacSys auth from session storage", async () => {
    const { chrome } = createServiceWorkerChrome({
      sessionStorageState: {
        samacsysFirefoxCapturedAuthorizationHeader: "Basic expired123",
        samacsysFirefoxCapturedAuthorizationCapturedAt:
          "2026-04-14T11:40:00.000Z"
      }
    });

    await expect(loadSettings(chrome)).resolves.toMatchObject({
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
  });

  it("ignores future-dated Firefox-captured SamacSys auth from session storage", async () => {
    const { chrome } = createServiceWorkerChrome({
      sessionStorageState: {
        samacsysFirefoxCapturedAuthorizationHeader: "Basic future123",
        samacsysFirefoxCapturedAuthorizationCapturedAt: "2999-01-01T00:00:00.000Z"
      }
    });

    await expect(loadSettings(chrome)).resolves.toMatchObject({
      samacsysFirefoxCapturedAuthorizationHeader: "",
      samacsysFirefoxCapturedAuthorizationCapturedAt: ""
    });
  });

  it("surfaces data-URL fallback download failures", async () => {
    const { chrome } = createServiceWorkerChrome();
    chrome.downloads.download.mockImplementation((_options, callback) => {
      chrome.runtime.lastError = { message: "Download blocked." };
      callback?.();
      chrome.runtime.lastError = null;
    });
    const downloads = createDownloadApi(chrome, {}, undefined);

    await expect(
      downloads.downloadTextFile("part.kicad_sym", "(symbol)", "application/octet-stream")
    ).rejects.toThrow("Download blocked.");
  });

  it("captures and persists the latest Firefox SamacSys Authorization header", async () => {
    const { chrome, listeners, sessionStorage } = createServiceWorkerChrome();
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

    expect(sessionStorage.samacsysFirefoxCapturedAuthorizationHeader).toBe(
      "Basic captured-from-browser"
    );
    expect(sessionStorage.samacsysFirefoxCapturedAuthorizationCapturedAt).toMatch(
      /^20\d\d-\d\d-\d\dT/
    );
  });

  it("refreshes SamacSys auth by triggering the page-native auth flow on the source tab", async () => {
    const { chrome, listeners, sessionStorage } = createServiceWorkerChrome({
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
      capturedAt: sessionStorage.samacsysFirefoxCapturedAuthorizationCapturedAt
    });
  });

  it("fails SamacSys auth refresh when the page-native auth trigger is unavailable", async () => {
    vi.useFakeTimers();
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

    try {
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
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("triggers the current Farnell page instead of opening a separate auth tab", async () => {
    const { chrome, listeners, sessionStorage } = createServiceWorkerChrome({
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
      capturedAt: sessionStorage.samacsysFirefoxCapturedAuthorizationCapturedAt
    });
  });

  it("merges symbol blocks without duplicating existing ids", () => {
    const symbolBlock = extractSymbolBlock(MOUSER_SYMBOL);
    const merged = mergeSymbolIntoLibrary(createSymbolLibrary(), symbolBlock, "STM32C552KEU6");

    expect(symbolBlock).toContain('(symbol "STM32C552KEU6"');
    expect(merged).toContain('(symbol "ExistingSymbol"');
    expect(merged).toContain('(symbol "STM32C552KEU6"');
    expect(mergeSymbolIntoLibrary(merged, symbolBlock, "STM32C552KEU6")).toBe(merged);
  });

  it("rewrites Mouser symbol and footprint library references", () => {
    expect(
      rewriteSamacsysSymbolFootprintReference(
        MOUSER_SYMBOL,
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

  it("extracts SamacSys assets from top-level KiCad and 3D ZIP directories", async () => {
    const textEncoder = new TextEncoder();
    const assets = await extractSamacsysKiCadAssets(
      new Uint8Array([0x50, 0x4b]),
      async () => [
        {
          name: "KiCad/STM32C552KEU6.kicad_sym",
          data: textEncoder.encode(MOUSER_SYMBOL)
        },
        {
          name: "KiCad/QFN50P500X500X60-33N-D.kicad_mod",
          data: textEncoder.encode(MOUSER_FOOTPRINT)
        },
        {
          name: "3D/STM32C552KEU6.step",
          data: new Uint8Array([1, 2, 3])
        },
        {
          name: "3D/STM32C552KEU6.wrl",
          data: textEncoder.encode("#VRML")
        }
      ]
    );

    expect(assets.symbols[0].filename).toBe("STM32C552KEU6.kicad_sym");
    expect(assets.footprints[0].filename).toBe("QFN50P500X500X60-33N-D.kicad_mod");
    expect(assets.stepModels[0].filename).toBe("STM32C552KEU6.step");
    expect(assets.wrlModels[0].filename).toBe("STM32C552KEU6.wrl");
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
