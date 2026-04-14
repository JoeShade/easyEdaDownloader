/*
 * This runtime module is the browser-local backend boundary. It normalizes the
 * popup message payload, applies runtime-specific gating, and dispatches work
 * to the provider adapters with shared worker dependencies.
 */

import {
  EASYEDA_PROVIDER,
  FARNELL_PROVIDER,
  MOUSER_PROVIDER,
  getBlockedPartContextError,
  isFirefoxRuntime,
  isSamacsysProvider,
  normalizePartContext
} from "./core/part_context.js";
import { createDownloadApi } from "./core/downloads.js";
import {
  loadSettings,
  parseSamacsysCapturedAuthorizationHeader
} from "./core/settings.js";
import { readZipEntries } from "./vendor/zip_reader.js";
import { createEasyedaAdapter } from "./sources/easyeda_adapter.js";
import { createSamacsysDistributorAdapter } from "./sources/samacsys_distributor_adapter.js";
import { getSamacsysAuthenticationErrorMessage } from "./sources/samacsys_common.js";
import { convertEasyedaCadToKicad, convertObjToWrlString } from "./kicad_converter.js";

const DEFAULT_SAMACSYS_AUTH_REFRESH_TIMEOUT_MS = 30000;
const SAMACSYS_AUTH_CAPTURE_LISTENERS = new Set();

function createSourceAdapters(deps) {
  return {
    [EASYEDA_PROVIDER]: createEasyedaAdapter(deps),
    [FARNELL_PROVIDER]: createSamacsysDistributorAdapter(deps),
    [MOUSER_PROVIDER]: createSamacsysDistributorAdapter(deps)
  };
}

function createRuntimeDeps(overrides = {}) {
  const chromeApi = overrides.chromeApi || globalThis.chrome;
  const deps = {
    chromeApi,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
    downloads:
      overrides.downloads ||
      createDownloadApi(
        chromeApi,
        overrides.urlApi || globalThis.URL,
        overrides.blobCtor || globalThis.Blob
      ),
    readZipEntries: overrides.readZipEntries || readZipEntries,
    userAgent: overrides.userAgent || globalThis.navigator?.userAgent,
    samacsysAuthRefreshTimeoutMs:
      overrides.samacsysAuthRefreshTimeoutMs ||
      DEFAULT_SAMACSYS_AUTH_REFRESH_TIMEOUT_MS,
    convertEasyedaCadToKicad:
      overrides.convertEasyedaCadToKicad || convertEasyedaCadToKicad,
    convertObjToWrlString: overrides.convertObjToWrlString || convertObjToWrlString
  };

  return {
    ...deps,
    sourceAdapters: overrides.sourceAdapters || createSourceAdapters(deps)
  };
}

function readAuthorizationHeader(requestHeaders = []) {
  const authorizationHeader = requestHeaders.find(
    (header) => String(header?.name || "").toLowerCase() === "authorization"
  );
  return parseSamacsysCapturedAuthorizationHeader(authorizationHeader?.value);
}

function notifySamacsysAuthorizationCaptured(payload) {
  for (const listener of SAMACSYS_AUTH_CAPTURE_LISTENERS) {
    listener(payload);
  }
}

function addSamacsysAuthorizationCaptureListener(listener) {
  SAMACSYS_AUTH_CAPTURE_LISTENERS.add(listener);
  return () => {
    SAMACSYS_AUTH_CAPTURE_LISTENERS.delete(listener);
  };
}

function registerSamacsysAuthorizationCapture(chromeApi, userAgent) {
  if (
    !isFirefoxRuntime(userAgent) ||
    !chromeApi?.webRequest?.onBeforeSendHeaders?.addListener ||
    chromeApi.__easyEdaSamacsysAuthCaptureRegistered
  ) {
    return;
  }

  chromeApi.__easyEdaSamacsysAuthCaptureRegistered = true;
  chromeApi.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const capturedAuthorizationHeader = readAuthorizationHeader(
        details?.requestHeaders
      );
      if (!capturedAuthorizationHeader) {
        return undefined;
      }
      const capturedAt = new Date().toISOString();

      chromeApi.storage?.local?.set?.(
        {
          samacsysFirefoxCapturedAuthorizationHeader:
            capturedAuthorizationHeader,
          samacsysFirefoxCapturedAuthorizationCapturedAt: capturedAt
        },
        () => {
          if (chromeApi.runtime?.lastError) {
            console.warn(
              "Failed to persist SamacSys Authorization header:",
              chromeApi.runtime.lastError
            );
            return;
          }
          notifySamacsysAuthorizationCaptured({
            authorizationHeader: capturedAuthorizationHeader,
            capturedAt
          });
        }
      );
      return undefined;
    },
    {
      urls: ["https://*.componentsearchengine.com/*"]
    },
    ["requestHeaders"]
  );
}

function sendTabMessage(chromeApi, tabId, message) {
  return new Promise((resolve, reject) => {
    if (!tabId || !chromeApi?.tabs?.sendMessage) {
      reject(new Error("SamacSys auth refresh requires the current product tab."));
      return;
    }

    chromeApi.tabs.sendMessage(tabId, message, (response) => {
      if (chromeApi.runtime?.lastError) {
        reject(
          new Error(chromeApi.runtime.lastError.message || "Tab message failed.")
        );
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || "SamacSys auth trigger failed."));
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function waitForSamacsysAuthorizationRefresh(chromeApi, startedAtMs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("SamacSys auth refresh timed out before a new authorization was captured."));
    }, timeoutMs);

    const cleanup = addSamacsysAuthorizationCaptureListener((payload) => {
      const capturedAtMs = Date.parse(payload?.capturedAt || "");
      if (!Number.isFinite(capturedAtMs) || capturedAtMs < startedAtMs) {
        return;
      }
      globalThis.clearTimeout(timeoutId);
      cleanup();
      resolve({
        authorizationHeader: payload.authorizationHeader || "",
        capturedAt: payload.capturedAt || ""
      });
    });
  });
}

async function refreshSamacsysAuthorization(
  partContext,
  sourceTabId,
  deps = createRuntimeDeps()
) {
  const normalizedPartContext = normalizePartContext(partContext);
  if (!normalizedPartContext || !isSamacsysProvider(normalizedPartContext.provider)) {
    throw new Error("SamacSys auth refresh is only available for SamacSys parts.");
  }
  if (!isFirefoxRuntime(deps.userAgent)) {
    throw new Error("SamacSys auth refresh is only needed on Firefox relay mode.");
  }

  if (!sourceTabId) {
    throw new Error("SamacSys auth refresh requires the current product tab.");
  }

  const startedAtMs = Date.now();
  const refreshPromise = waitForSamacsysAuthorizationRefresh(
    deps.chromeApi,
    startedAtMs,
    deps.samacsysAuthRefreshTimeoutMs
  );

  await sendTabMessage(deps.chromeApi, sourceTabId, {
    type: "TRIGGER_SAMACSYS_AUTH",
    partContext: normalizedPartContext
  });

  const refreshResult = await refreshPromise;

  return {
    ok: true,
    authorizationHeader: refreshResult.authorizationHeader,
    capturedAt: refreshResult.capturedAt
  };
}

function getSourceAdapter(provider, deps) {
  if (deps?.sourceAdapters?.[provider]) {
    return deps.sourceAdapters[provider];
  }
  return createSourceAdapters(deps)[provider];
}

async function getPartPreviews(partContext, deps = createRuntimeDeps()) {
  const normalizedPartContext = normalizePartContext(partContext);
  if (!normalizedPartContext) {
    throw new Error("No supported part found on the page.");
  }
  const settings = deps.settings || (await loadSettings(deps.chromeApi));

  const blockedError = getBlockedPartContextError(
    normalizedPartContext,
    deps.userAgent || globalThis.navigator?.userAgent,
    settings.samacsysFirefoxProxyBaseUrl
  );
  if (blockedError) {
    throw new Error(blockedError);
  }

  const adapter = getSourceAdapter(normalizedPartContext.provider, deps);
  if (!adapter) {
    throw new Error("Unsupported provider.");
  }
  return adapter.getPreviews(normalizedPartContext);
}

async function exportPart(partContext, options = {}, deps = createRuntimeDeps()) {
  return exportPartWithRetry(partContext, options, deps, {
    sourceTabId: null,
    allowAuthRefreshRetry: true
  });
}

async function exportPartWithRetry(
  partContext,
  options = {},
  deps = createRuntimeDeps(),
  { sourceTabId = null, allowAuthRefreshRetry = true } = {}
) {
  const normalizedPartContext = normalizePartContext(partContext);
  if (!normalizedPartContext) {
    throw new Error("No supported part found on the page.");
  }
  const settings = deps.settings || (await loadSettings(deps.chromeApi));

  const blockedError = getBlockedPartContextError(
    normalizedPartContext,
    deps.userAgent || globalThis.navigator?.userAgent,
    settings.samacsysFirefoxProxyBaseUrl
  );
  if (blockedError) {
    throw new Error(blockedError);
  }

  const adapter = getSourceAdapter(normalizedPartContext.provider, deps);
  if (!adapter) {
    throw new Error("Unsupported provider.");
  }

  try {
    return await adapter.exportPart(normalizedPartContext, options);
  } catch (error) {
    const shouldRetryWithRefresh =
      allowAuthRefreshRetry &&
      isFirefoxRuntime(deps.userAgent) &&
      isSamacsysProvider(normalizedPartContext.provider) &&
      error?.message === getSamacsysAuthenticationErrorMessage();

    if (!shouldRetryWithRefresh) {
      throw error;
    }

    const refreshResult = await refreshSamacsysAuthorization(
      normalizedPartContext,
      sourceTabId,
      deps
    );
    const retryResult = await exportPartWithRetry(normalizedPartContext, options, deps, {
      sourceTabId,
      allowAuthRefreshRetry: false
    });
    return {
      ...retryResult,
      authRefreshed: true,
      authAuthorizationHeader: refreshResult.authorizationHeader || "",
      authCapturedAt: refreshResult.capturedAt || ""
    };
  }
}

function registerServiceWorkerRuntime(chromeApi = globalThis.chrome, overrides = {}) {
  const deps = createRuntimeDeps({ ...overrides, chromeApi });
  registerSamacsysAuthorizationCapture(chromeApi, deps.userAgent);

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PART_PREVIEWS") {
      getPartPreviews(message.partContext, deps)
        .then((result) => {
          sendResponse({
            ok: true,
            previews: result.previews,
            metadata: result.metadata
          });
        })
        .catch((error) => {
          console.error("easy EDA downloader preview error:", error);
          sendResponse({ ok: false, error: error?.message || "Preview failed." });
        });
      return true;
    }

    if (message?.type === "EXPORT_PART") {
      exportPartWithRetry(message.partContext, message.options, deps, {
        sourceTabId: message.sourceTabId || null,
        allowAuthRefreshRetry: true
      })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
          console.error("easy EDA downloader extension error:", error);
          sendResponse({ ok: false, error: error?.message || "Download failed." });
        });
      return true;
    }

    if (message?.type === "REFRESH_SAMACSYS_AUTH") {
      refreshSamacsysAuthorization(message.partContext, message.sourceTabId || null, deps)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error("easy EDA downloader auth refresh error:", error);
          sendResponse({ ok: false, error: error?.message || "Auth refresh failed." });
        });
      return true;
    }

    return false;
  });
}

export {
  addSamacsysAuthorizationCaptureListener,
  createRuntimeDeps,
  createSourceAdapters,
  exportPart,
  exportPartWithRetry,
  refreshSamacsysAuthorization,
  getPartPreviews,
  registerSamacsysAuthorizationCapture,
  registerServiceWorkerRuntime
};

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
