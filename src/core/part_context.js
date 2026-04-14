/*
 * Shared provider and gating helpers. These keep provider ids, runtime
 * normalization, and Firefox SamacSys blocking rules consistent between the
 * popup and the service worker.
 */

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";
const FARNELL_PROVIDER = "farnellSamacsys";

function normalizePartContext(partContext) {
  if (!partContext?.provider) {
    return null;
  }
  return {
    provider: partContext.provider,
    sourcePartLabel: partContext.sourcePartLabel || null,
    sourcePartNumber: partContext.sourcePartNumber || null,
    manufacturerPartNumber: partContext.manufacturerPartNumber || null,
    lookup: partContext.lookup || {}
  };
}

function isFirefoxRuntime(userAgent = globalThis.navigator?.userAgent) {
  return /firefox/i.test(String(userAgent || ""));
}

function isSamacsysProvider(provider) {
  return /Samacsys$/i.test(String(provider || ""));
}

function hasSamacsysFirefoxProxy(proxyBaseUrl) {
  return Boolean(String(proxyBaseUrl || "").trim());
}

function isBlockedPartContext(partContext, userAgent, samacsysFirefoxProxyBaseUrl = "") {
  return (
    isSamacsysProvider(partContext?.provider) &&
    isFirefoxRuntime(userAgent) &&
    !hasSamacsysFirefoxProxy(samacsysFirefoxProxyBaseUrl)
  );
}

function getBlockedPartContextError(
  partContext,
  userAgent,
  samacsysFirefoxProxyBaseUrl = ""
) {
  if (isBlockedPartContext(partContext, userAgent, samacsysFirefoxProxyBaseUrl)) {
    return "SamacSys distributor downloads require a proxy in Firefox. Chrome-only for now.";
  }
  return "";
}

export {
  EASYEDA_PROVIDER,
  FARNELL_PROVIDER,
  MOUSER_PROVIDER,
  hasSamacsysFirefoxProxy,
  isSamacsysProvider,
  normalizePartContext,
  isFirefoxRuntime,
  isBlockedPartContext,
  getBlockedPartContextError
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
