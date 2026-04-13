const DEFAULT_LIBRARY_DOWNLOAD_ROOT = "easyEDADownloader";

const DEFAULT_SETTINGS = {
  downloadIndividually: false,
  libraryDownloadRoot: DEFAULT_LIBRARY_DOWNLOAD_ROOT
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

async function loadSettings(chromeApi) {
  return new Promise((resolve) => {
    chromeApi.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      if (chromeApi.runtime.lastError) {
        console.warn("Failed to load settings:", chromeApi.runtime.lastError);
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      resolve({
        downloadIndividually:
          typeof settings.downloadIndividually === "boolean"
            ? settings.downloadIndividually
            : DEFAULT_SETTINGS.downloadIndividually,
        libraryDownloadRoot: normalizeLibraryDownloadRoot(
          settings.libraryDownloadRoot
        )
      });
    });
  });
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
  DEFAULT_SETTINGS,
  parseLibraryDownloadRoot,
  normalizeLibraryDownloadRoot,
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
