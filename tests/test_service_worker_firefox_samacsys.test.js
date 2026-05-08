/*
 * These tests cover Firefox SamacSys relay, cookie forwarding, auth refresh,
 * and proxy error behavior.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createSamacsysFetchImpl,
  createSamacsysPartHtml,
  createSamacsysPartContext,
  createServiceWorkerChrome,
  emitBeforeSendHeaders,
  loadServiceWorker,
  MOUSER_FOOTPRINT,
  MOUSER_SYMBOL,
  sendRuntimeMessage
} from "./helpers/service_worker_harness.js";

describe("service worker Firefox SamacSys flow", () => {
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
        data: new TextEncoder().encode(MOUSER_SYMBOL)
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
      error:
        "SamacSys distributor downloads in Firefox require a configured proxy relay. Configure the Firefox SamacSys proxy URL in Advanced settings or use Chrome."
    });
    expect(exportResult.response).toEqual({
      ok: false,
      error:
        "SamacSys distributor downloads in Firefox require a configured proxy relay. Configure the Firefox SamacSys proxy URL in Advanced settings or use Chrome."
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
