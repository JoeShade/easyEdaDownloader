/*
 * These tests cover direct Chrome SamacSys preview/export behavior and ZIP
 * authentication retry handling.
 */

import { describe, expect, it, vi } from "vitest";

import { createSymbolLibrary } from "./helpers/fixtures.js";
import { stripKicadFootprintModels } from "../src/sources/samacsys_common.js";
import {
  createDirectSamacsysZipFetchImpl,
  createMockHeaders,
  createSamacsysFetchImpl,
  createSamacsysPartHtml,
  createSamacsysPartContext,
  createServiceWorkerChrome,
  loadServiceWorker,
  MOUSER_FOOTPRINT,
  MOUSER_SYMBOL,
  sendRuntimeMessage
} from "./helpers/service_worker_harness.js";

describe("service worker SamacSys direct flow", () => {
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
        data: new TextEncoder().encode(MOUSER_SYMBOL)
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
        data: new TextEncoder().encode(MOUSER_SYMBOL)
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

  it("skips the SamacSys ZIP request when only unsupported datasheet export is selected", async () => {
    const { chrome, listeners } = createServiceWorkerChrome();
    const fetchImpl = vi.fn();
    loadServiceWorker({
      chrome,
      fetchImpl
    });

    const result = await sendRuntimeMessage(listeners.runtimeMessage[0], {
      type: "EXPORT_PART",
      partContext: createSamacsysPartContext("mouser"),
      options: {
        symbol: false,
        footprint: false,
        model3d: false,
        datasheet: true
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: [
        "Datasheet export is not available for SamacSys distributor parts."
      ],
      downloadCount: 0
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it("warns when a selected SamacSys asset type is absent from the ZIP", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/QFN50P500X500X60-33N-D.kicad_mod",
        data: new TextEncoder().encode(MOUSER_FOOTPRINT)
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
        footprint: false,
        model3d: false,
        datasheet: false
      }
    });

    expect(result.response).toEqual({
      ok: true,
      warnings: ["Symbol not available in the SamacSys ZIP."],
      downloadCount: 0
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
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

  it("does not preemptively attach generated SamacSys auth on Chrome ZIP exports", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true,
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123",
        rememberSamacsysCredentials: true
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUSER_SYMBOL)
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

  it("retries one Chrome SamacSys ZIP request with generated Basic auth after a 401", async () => {
    const { chrome, listeners } = createServiceWorkerChrome({
      storageState: {
        downloadIndividually: true
      },
      sessionStorageState: {
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123"
      }
    });
    const readZipEntries = vi.fn(async () => [
      {
        name: "STM32C552KEU6/KiCad/STM32C552KEU6.kicad_sym",
        data: new TextEncoder().encode(MOUSER_SYMBOL)
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
        downloadIndividually: true
      },
      sessionStorageState: {
        samacsysFirefoxUsername: "user@example.com",
        samacsysFirefoxPassword: "secret123"
      }
    });
    const readZipEntries = vi.fn(async () => []);
    const fetchImpl = createDirectSamacsysZipFetchImpl({
      zipStatuses: [401, 401],
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
      ok: false,
      error:
        "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded."
    });
    expect(fetchImpl.getZipCalls()).toHaveLength(2);
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
