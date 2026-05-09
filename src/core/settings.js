// SamacSys/relay work in this file: JoeShade and Josh Webster
/*
 * Shared popup and worker settings helpers. This module keeps the Downloads-
 * relative library-root rules in one place so UI validation and backend path
 * resolution stay aligned.
 */

const DEFAULT_LIBRARY_DOWNLOAD_ROOT = "easyEDADownloader";
const DEFAULT_SAMACSYS_FIREFOX_PROXY_BASE_URL = "";
const DEFAULT_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER = "";
const DEFAULT_SAMACSYS_FIREFOX_USERNAME = "";
const DEFAULT_SAMACSYS_FIREFOX_PASSWORD = "";
const DEFAULT_SAMACSYS_FIREFOX_AUTHORIZATION_HEADER = "";
const DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER = "";
const DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT = "";
const DEFAULT_REMEMBER_SAMACSYS_CREDENTIALS = false;
const DEFAULT_REMEMBER_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER = false;
const SAMACSYS_CAPTURED_AUTH_SESSION_TTL_MS = 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  downloadIndividually: false,
  libraryDownloadRoot: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
  samacsysFirefoxProxyBaseUrl: DEFAULT_SAMACSYS_FIREFOX_PROXY_BASE_URL,
  samacsysFirefoxProxyAuthorizationHeader:
    DEFAULT_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER,
  samacsysFirefoxUsername: DEFAULT_SAMACSYS_FIREFOX_USERNAME,
  samacsysFirefoxPassword: DEFAULT_SAMACSYS_FIREFOX_PASSWORD,
  samacsysFirefoxAuthorizationHeader:
    DEFAULT_SAMACSYS_FIREFOX_AUTHORIZATION_HEADER,
  samacsysFirefoxCapturedAuthorizationHeader:
    DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER,
  samacsysFirefoxCapturedAuthorizationCapturedAt:
    DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT,
  rememberSamacsysCredentials: DEFAULT_REMEMBER_SAMACSYS_CREDENTIALS,
  rememberSamacsysFirefoxProxyAuthorizationHeader:
    DEFAULT_REMEMBER_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER
};

const SESSION_SECRET_SETTINGS = {
  samacsysFirefoxProxyAuthorizationHeader:
    DEFAULT_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER,
  samacsysFirefoxUsername: DEFAULT_SAMACSYS_FIREFOX_USERNAME,
  samacsysFirefoxPassword: DEFAULT_SAMACSYS_FIREFOX_PASSWORD,
  samacsysFirefoxCapturedAuthorizationHeader:
    DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER,
  samacsysFirefoxCapturedAuthorizationCapturedAt:
    DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT
};

function parseLibraryDownloadRoot(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }
  if (
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    raw.startsWith("\\\\") ||
    /^[a-zA-Z]:/.test(raw)
  ) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  const normalized = raw.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return {
      value: DEFAULT_LIBRARY_DOWNLOAD_ROOT,
      isValid: false
    };
  }

  return {
    value: normalized,
    isValid: true
  };
}

function normalizeLibraryDownloadRoot(value) {
  return parseLibraryDownloadRoot(value).value;
}

function parseSamacsysFirefoxProxyBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      value: DEFAULT_SAMACSYS_FIREFOX_PROXY_BASE_URL,
      isValid: true
    };
  }

  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) {
      throw new Error("Invalid protocol");
    }
    url.hash = "";
    return {
      value: url.toString(),
      isValid: true
    };
  } catch (error) {
    return {
      value: DEFAULT_SAMACSYS_FIREFOX_PROXY_BASE_URL,
      isValid: false
    };
  }
}

function normalizeSamacsysFirefoxProxyBaseUrl(value) {
  return parseSamacsysFirefoxProxyBaseUrl(value).value;
}

function parseAuthorizationHeaderValue(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^authorization\s*:\s*/i, "");
  if (/[\r\n]/.test(normalized)) {
    return "";
  }
  return normalized;
}

function parseSamacsysProxyAuthorizationHeader(value) {
  return (
    parseAuthorizationHeaderValue(value) ||
    DEFAULT_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER
  );
}

function parseSamacsysCredentialValue(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

function parseSamacsysAuthorizationHeader(value) {
  return (
    parseAuthorizationHeaderValue(value) ||
    DEFAULT_SAMACSYS_FIREFOX_AUTHORIZATION_HEADER
  );
}

function parseSamacsysCapturedAuthorizationHeader(value) {
  return (
    parseAuthorizationHeaderValue(value) ||
    DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER
  );
}

function parseSamacsysCapturedAuthorizationCapturedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT;
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) {
    return DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT;
  }
  return parsedDate.toISOString();
}

function isSamacsysCapturedAuthorizationFresh(capturedAt, nowMs = Date.now()) {
  const normalizedCapturedAt = parseSamacsysCapturedAuthorizationCapturedAt(
    capturedAt
  );
  if (!normalizedCapturedAt) {
    return false;
  }
  const capturedAtMs = new Date(normalizedCapturedAt).getTime();
  return nowMs - capturedAtMs <= SAMACSYS_CAPTURED_AUTH_SESSION_TTL_MS;
}

function resolveSamacsysAuthorizationHeader(settings = {}) {
  return (
    parseSamacsysAuthorizationHeader(settings.samacsysFirefoxAuthorizationHeader) ||
    buildSamacsysBasicAuthorizationHeader(
      settings.samacsysFirefoxUsername,
      settings.samacsysFirefoxPassword
    ) ||
    parseSamacsysCapturedAuthorizationHeader(
      settings.samacsysFirefoxCapturedAuthorizationHeader
    ) ||
    ""
  );
}

function encodeBase64(value) {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  return Buffer.from(value, "binary").toString("base64");
}

function buildSamacsysBasicAuthorizationHeader(username, password) {
  const normalizedUsername = parseSamacsysCredentialValue(
    username,
    DEFAULT_SAMACSYS_FIREFOX_USERNAME
  );
  const normalizedPassword = parseSamacsysCredentialValue(
    password,
    DEFAULT_SAMACSYS_FIREFOX_PASSWORD
  );
  if (!normalizedUsername || !normalizedPassword) {
    return "";
  }

  const utf8Bytes = new TextEncoder().encode(
    `${normalizedUsername}:${normalizedPassword}`
  );
  let binary = "";
  for (const byte of utf8Bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${encodeBase64(binary)}`;
}

function getSessionStorageArea(chromeApi) {
  return chromeApi?.storage?.session || null;
}

function getStorageArea(area, defaults, chromeApi) {
  return new Promise((resolve) => {
    if (!area?.get) {
      resolve({ ...defaults });
      return;
    }
    area.get(defaults, (settings) => {
      if (chromeApi.runtime.lastError) {
        console.warn("Failed to load settings:", chromeApi.runtime.lastError);
        resolve({ ...defaults });
        return;
      }
      resolve(settings || { ...defaults });
    });
  });
}

async function loadSettings(chromeApi) {
  const [settings, sessionSettings] = await Promise.all([
    getStorageArea(chromeApi.storage.local, DEFAULT_SETTINGS, chromeApi),
    getStorageArea(
      getSessionStorageArea(chromeApi),
      SESSION_SECRET_SETTINGS,
      chromeApi
    )
  ]);
  const rememberSamacsysCredentials =
    typeof settings.rememberSamacsysCredentials === "boolean"
      ? settings.rememberSamacsysCredentials
      : DEFAULT_SETTINGS.rememberSamacsysCredentials;
  const rememberSamacsysFirefoxProxyAuthorizationHeader =
    typeof settings.rememberSamacsysFirefoxProxyAuthorizationHeader === "boolean"
      ? settings.rememberSamacsysFirefoxProxyAuthorizationHeader
      : DEFAULT_SETTINGS.rememberSamacsysFirefoxProxyAuthorizationHeader;
  const credentialSettings = rememberSamacsysCredentials
    ? settings
    : sessionSettings;
  const proxyAuthorizationSettings =
    rememberSamacsysFirefoxProxyAuthorizationHeader ? settings : sessionSettings;
  const capturedAuthorizationCapturedAt =
    parseSamacsysCapturedAuthorizationCapturedAt(
      sessionSettings.samacsysFirefoxCapturedAuthorizationCapturedAt
    );
  const capturedAuthorizationHeader =
    isSamacsysCapturedAuthorizationFresh(capturedAuthorizationCapturedAt)
      ? parseSamacsysCapturedAuthorizationHeader(
          sessionSettings.samacsysFirefoxCapturedAuthorizationHeader
        )
      : DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER;

  return {
    downloadIndividually:
      typeof settings.downloadIndividually === "boolean"
        ? settings.downloadIndividually
        : DEFAULT_SETTINGS.downloadIndividually,
    libraryDownloadRoot: normalizeLibraryDownloadRoot(
      settings.libraryDownloadRoot
    ),
    samacsysFirefoxProxyBaseUrl: normalizeSamacsysFirefoxProxyBaseUrl(
      settings.samacsysFirefoxProxyBaseUrl
    ),
    samacsysFirefoxProxyAuthorizationHeader:
      parseSamacsysProxyAuthorizationHeader(
        proxyAuthorizationSettings.samacsysFirefoxProxyAuthorizationHeader
      ),
    samacsysFirefoxUsername: parseSamacsysCredentialValue(
      credentialSettings.samacsysFirefoxUsername,
      DEFAULT_SAMACSYS_FIREFOX_USERNAME
    ),
    samacsysFirefoxPassword: parseSamacsysCredentialValue(
      credentialSettings.samacsysFirefoxPassword,
      DEFAULT_SAMACSYS_FIREFOX_PASSWORD
    ),
    samacsysFirefoxAuthorizationHeader: parseSamacsysAuthorizationHeader(
      settings.samacsysFirefoxAuthorizationHeader
    ),
    samacsysFirefoxCapturedAuthorizationHeader: capturedAuthorizationHeader,
    samacsysFirefoxCapturedAuthorizationCapturedAt: capturedAuthorizationHeader
      ? capturedAuthorizationCapturedAt
      : DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT,
    rememberSamacsysCredentials,
    rememberSamacsysFirefoxProxyAuthorizationHeader
  };
}

function buildLibraryPaths(libraryDownloadRoot = DEFAULT_LIBRARY_DOWNLOAD_ROOT) {
  const libraryName = libraryDownloadRoot.split("/").pop() || DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  return {
    symbolFile: `${libraryDownloadRoot}/${libraryName}.kicad_sym`,
    footprintDir: `${libraryDownloadRoot}/${libraryName}.pretty`,
    modelDir: `${libraryDownloadRoot}/${libraryName}.3dshapes`
  };
}

export {
  DEFAULT_LIBRARY_DOWNLOAD_ROOT,
  DEFAULT_SAMACSYS_FIREFOX_PROXY_BASE_URL,
  DEFAULT_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER,
  DEFAULT_SAMACSYS_FIREFOX_USERNAME,
  DEFAULT_SAMACSYS_FIREFOX_PASSWORD,
  DEFAULT_SAMACSYS_FIREFOX_AUTHORIZATION_HEADER,
  DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_HEADER,
  DEFAULT_SAMACSYS_FIREFOX_CAPTURED_AUTHORIZATION_CAPTURED_AT,
  DEFAULT_REMEMBER_SAMACSYS_CREDENTIALS,
  DEFAULT_REMEMBER_SAMACSYS_FIREFOX_PROXY_AUTHORIZATION_HEADER,
  DEFAULT_SETTINGS,
  SAMACSYS_CAPTURED_AUTH_SESSION_TTL_MS,
  buildSamacsysBasicAuthorizationHeader,
  parseLibraryDownloadRoot,
  parseSamacsysFirefoxProxyBaseUrl,
  parseSamacsysCredentialValue,
  parseSamacsysProxyAuthorizationHeader,
  parseSamacsysAuthorizationHeader,
  parseSamacsysCapturedAuthorizationHeader,
  parseSamacsysCapturedAuthorizationCapturedAt,
  isSamacsysCapturedAuthorizationFresh,
  resolveSamacsysAuthorizationHeader,
  normalizeLibraryDownloadRoot,
  normalizeSamacsysFirefoxProxyBaseUrl,
  loadSettings,
  buildLibraryPaths
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
