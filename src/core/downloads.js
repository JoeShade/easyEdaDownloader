/*
 * Shared download helpers for the service worker. These wrap chrome.downloads
 * so adapters can write text, binary, and URL-backed artifacts without
 * duplicating Blob/data-URL fallback logic or object-URL cleanup.
 */

import { arrayBufferToBase64, textToBase64 } from "./preview_data.js";

function createDownloadApi(chromeApi, urlApi = globalThis.URL, blobCtor = globalThis.Blob) {
  const activeDownloadUrls = new Map();
  const canUseBlobUrl =
    typeof urlApi !== "undefined" &&
    typeof urlApi.createObjectURL === "function" &&
    typeof blobCtor !== "undefined";

  chromeApi.downloads.onChanged.addListener((delta) => {
    if (!delta?.state?.current) {
      return;
    }
    if (delta.state.current !== "complete" && delta.state.current !== "interrupted") {
      return;
    }
    const url = activeDownloadUrls.get(delta.id);
    if (url) {
      urlApi.revokeObjectURL(url);
      activeDownloadUrls.delete(delta.id);
    }
  });

  async function downloadBlobUrl(filename, blob, conflictAction) {
    const url = urlApi.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      chromeApi.downloads.download(
        {
          url,
          filename,
          conflictAction: conflictAction || "uniquify"
        },
        (downloadId) => {
          if (chromeApi.runtime.lastError || !downloadId) {
            urlApi.revokeObjectURL(url);
            reject(
              new Error(
                chromeApi.runtime.lastError?.message || "Download failed to start."
              )
            );
            return;
          }
          activeDownloadUrls.set(downloadId, url);
          resolve(downloadId);
        }
      );
    });
  }

  async function downloadTextFile(filename, text, mimeType, conflictAction) {
    if (canUseBlobUrl) {
      const blob = new blobCtor([text], { type: mimeType });
      await downloadBlobUrl(filename, blob, conflictAction);
      return;
    }
    const base64 = textToBase64(text);
    const url = `data:${mimeType};base64,${base64}`;
    await chromeApi.downloads.download({
      url,
      filename,
      conflictAction: conflictAction || "uniquify"
    });
  }

  async function downloadBinaryFile(filename, buffer, mimeType, conflictAction) {
    if (canUseBlobUrl) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const blob = new blobCtor([bytes], { type: mimeType });
      await downloadBlobUrl(filename, blob, conflictAction);
      return;
    }
    const base64 = arrayBufferToBase64(buffer);
    const url = `data:${mimeType};base64,${base64}`;
    await chromeApi.downloads.download({
      url,
      filename,
      conflictAction: conflictAction || "uniquify"
    });
  }

  async function downloadUrlFile(filename, url, conflictAction) {
    return new Promise((resolve, reject) => {
      chromeApi.downloads.download(
        {
          url,
          filename,
          conflictAction: conflictAction || "uniquify"
        },
        (downloadId) => {
          if (chromeApi.runtime.lastError || !downloadId) {
            reject(
              new Error(
                chromeApi.runtime.lastError?.message || "Download failed to start."
              )
            );
            return;
          }
          resolve(downloadId);
        }
      );
    });
  }

  return {
    downloadTextFile,
    downloadBinaryFile,
    downloadUrlFile
  };
}

export { createDownloadApi };

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
