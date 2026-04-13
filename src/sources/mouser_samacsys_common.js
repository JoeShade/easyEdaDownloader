import { makeBase64DataUrl } from "../core/preview_data.js";
import { readZipEntries } from "../vendor/zip_reader.js";

const DEFAULT_SAMACSYS_BASE_URL = "https://ms.componentsearchengine.com";

function getSamacsysBaseUrl(partContext, fallbackUrl = DEFAULT_SAMACSYS_BASE_URL) {
  const configuredBaseUrl = partContext?.lookup?.samacsysBaseUrl;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  try {
    return new URL(partContext?.lookup?.entryUrl || fallbackUrl).origin;
  } catch (error) {
    return fallbackUrl;
  }
}

function ensureAbsoluteUrl(url, origin = DEFAULT_SAMACSYS_BASE_URL) {
  if (!url) {
    return "";
  }
  return new URL(url, origin).toString();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTagAttributeValue(tagText, attributeName) {
  const match = String(tagText || "").match(
    new RegExp(`${attributeName}\\s*=\\s*["']([^"']*)["']`, "i")
  );
  return match ? match[1] : "";
}

function parseFormById(html, formId) {
  const match = String(html || "").match(
    new RegExp(
      `<form\\b[^>]*id=["']${escapeRegExp(formId)}["'][^>]*>[\\s\\S]*?<\\/form>`,
      "i"
    )
  );
  if (!match) {
    return null;
  }

  const formText = match[0];
  const openTagMatch = formText.match(/<form\b[^>]*>/i);
  const openTag = openTagMatch ? openTagMatch[0] : "";
  const inputs = {};

  for (const inputMatch of formText.matchAll(/<input\b[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const tagText = inputMatch[0];
    const name = inputMatch[1];
    inputs[name] = extractTagAttributeValue(tagText, "value");
  }

  return {
    action: extractTagAttributeValue(openTag, "action"),
    method: extractTagAttributeValue(openTag, "method") || "GET",
    inputs
  };
}

function parseSamacsysPartId(url, zipForm) {
  try {
    const partId = new URL(url).searchParams.get("partID");
    if (partId) {
      return partId;
    }
  } catch (error) {
    console.warn("Failed to parse SamacSys part URL:", error);
  }

  return zipForm?.inputs?.partID || "";
}

function buildSamacsysPreviewPageUrl(baseUrl, partId, partnerName = "mouser") {
  return `${baseUrl}/preview_newDesign.php?o3=0&partID=${encodeURIComponent(partId)}&ev=0&fmt=zip&pna=${encodeURIComponent(partnerName)}`;
}

function parseSamacsysPageMetadata(html, finalUrl, baseUrl = DEFAULT_SAMACSYS_BASE_URL) {
  const zipForm = parseFormById(html, "zipForm");
  const partId = parseSamacsysPartId(finalUrl, zipForm);
  const token = zipForm?.inputs?.tok || "";
  if (!partId) {
    throw new Error("SamacSys part ID was not found.");
  }
  if (!zipForm?.action) {
    throw new Error("SamacSys ZIP download form was not found.");
  }
  if (!token) {
    throw new Error("SamacSys preview token was not found.");
  }

  return {
    partId,
    token,
    pageUrl: finalUrl,
    baseUrl,
    zipActionUrl: ensureAbsoluteUrl(zipForm.action, baseUrl),
    zipMethod: String(zipForm.method || "GET").toUpperCase(),
    zipFormInputs: {
      ...zipForm.inputs,
      tok: token,
      partID: zipForm.inputs.partID || partId,
      fmt: zipForm.inputs.fmt || "zip"
    }
  };
}

async function fetchMouserSamacsysPageMetadata(fetchImpl, partContext) {
  const entryUrl = partContext?.lookup?.entryUrl;
  if (!entryUrl) {
    throw new Error("SamacSys entry URL was not found on the page.");
  }
  const baseUrl = getSamacsysBaseUrl(partContext, entryUrl);
  const partnerName = partContext?.lookup?.partnerName || "mouser";

  const response = await fetchImpl(entryUrl, {
    credentials: "include",
    headers: {
      Accept: "text/html"
    }
  });
  if (!response.ok) {
    throw new Error(`SamacSys entry request failed: ${response.status}`);
  }

  const entryHtml = await response.text();
  const entryFinalUrl = response.url || entryUrl;
  const entryZipForm = parseFormById(entryHtml, "zipForm");
  const partId = parseSamacsysPartId(entryFinalUrl, entryZipForm);
  if (!partId) {
    throw new Error("SamacSys part ID was not found.");
  }

  const previewPageUrl = buildSamacsysPreviewPageUrl(baseUrl, partId, partnerName);
  const previewResponse = await fetchImpl(previewPageUrl, {
    credentials: "include",
    headers: {
      Accept: "text/html"
    }
  });
  if (!previewResponse.ok) {
    throw new Error(`SamacSys preview page request failed: ${previewResponse.status}`);
  }

  const previewHtml = await previewResponse.text();
  return parseSamacsysPageMetadata(
    previewHtml,
    previewResponse.url || previewPageUrl,
    baseUrl
  );
}

async function fetchSamacsysPreview(fetchImpl, url) {
  const response = await fetchImpl(url, {
    credentials: "include",
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`SamacSys preview request failed: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.Image || "";
}

async function buildMouserPreviewResponse(fetchImpl, partContext) {
  const metadata = await fetchMouserSamacsysPageMetadata(fetchImpl, partContext);
  const symbolUrl = `${metadata.baseUrl}/symbol.php?scale=4&format=JSON&partID=${encodeURIComponent(metadata.partId)}&showKeepout=0&u=0&tok=${encodeURIComponent(metadata.token)}`;
  const footprintUrl = `${metadata.baseUrl}/footprint.php?scale=100&format=JSON&partID=${encodeURIComponent(metadata.partId)}&showKeepout=0&u=0&tok=${encodeURIComponent(metadata.token)}&sz=N`;

  const [symbolImage, footprintImage] = await Promise.all([
    fetchSamacsysPreview(fetchImpl, symbolUrl),
    fetchSamacsysPreview(fetchImpl, footprintUrl)
  ]);

  return {
    previews: {
      symbolUrl: makeBase64DataUrl("image/png", symbolImage),
      footprintUrl: makeBase64DataUrl("image/png", footprintImage)
    },
    metadata: {
      datasheetAvailable: false
    }
  };
}

function ensureZipPayload(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 2));
  if (signature !== "PK") {
    throw new Error("SamacSys ZIP download did not return a ZIP archive.");
  }
  return bytes;
}

function basenameFromZipPath(filePath) {
  return String(filePath || "").split("/").pop() || "";
}

function filenameWithoutExtension(filename) {
  return String(filename || "").replace(/\.[^.]+$/, "");
}

function buildQueryString(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");
}

function decodeZipText(bytes) {
  return new TextDecoder().decode(bytes);
}

async function extractSamacsysKiCadAssets(zipBuffer, readZipEntriesImpl = readZipEntries) {
  const entries = await readZipEntriesImpl(zipBuffer);
  const symbolEntries = entries.filter(
    (entry) => entry.name.includes("/KiCad/") && entry.name.endsWith(".kicad_sym")
  );
  const footprintEntries = entries.filter(
    (entry) => entry.name.includes("/KiCad/") && entry.name.endsWith(".kicad_mod")
  );
  const stepEntries = entries.filter(
    (entry) => entry.name.includes("/3D/") && entry.name.toLowerCase().endsWith(".stp")
  );
  const wrlEntries = entries.filter(
    (entry) => entry.name.includes("/3D/") && entry.name.toLowerCase().endsWith(".wrl")
  );

  if (!symbolEntries.length && !footprintEntries.length && !stepEntries.length) {
    throw new Error("SamacSys ZIP did not contain KiCad assets.");
  }

  return {
    symbols: symbolEntries.map((entry) => ({
      path: entry.name,
      filename: basenameFromZipPath(entry.name),
      name: filenameWithoutExtension(basenameFromZipPath(entry.name)),
      content: decodeZipText(entry.data)
    })),
    footprints: footprintEntries.map((entry) => ({
      path: entry.name,
      filename: basenameFromZipPath(entry.name),
      name: filenameWithoutExtension(basenameFromZipPath(entry.name)),
      content: decodeZipText(entry.data)
    })),
    stepModels: stepEntries.map((entry) => ({
      path: entry.name,
      filename: basenameFromZipPath(entry.name),
      name: filenameWithoutExtension(basenameFromZipPath(entry.name)),
      data: entry.data
    })),
    wrlModels: wrlEntries.map((entry) => ({
      path: entry.name,
      filename: basenameFromZipPath(entry.name),
      name: filenameWithoutExtension(basenameFromZipPath(entry.name)),
      content: decodeZipText(entry.data)
    }))
  };
}

function rewriteSamacsysSymbolFootprintReference(symbolLibraryText, footprintName, libraryName) {
  if (!footprintName || !libraryName) {
    return symbolLibraryText;
  }
  return String(symbolLibraryText).replace(
    /(\(property "Footprint" ")([^"]*)(")/,
    `$1${libraryName}:${footprintName}$3`
  );
}

function rewriteSamacsysFootprintModelPath(footprintText, modelFilename, libraryName) {
  if (!modelFilename || !libraryName) {
    return footprintText;
  }
  return String(footprintText).replace(
    /(\(model\s+)(\"?)([^"\s)]+)(\"?)/,
    `$1$2../${libraryName}.3dshapes/${modelFilename}$4`
  );
}

function stripKicadFootprintModels(footprintText) {
  const text = String(footprintText || "");
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const modelStart = text.indexOf("(model", cursor);
    if (modelStart === -1) {
      result += text.slice(cursor);
      break;
    }

    let blockStart = modelStart;
    while (blockStart > cursor && /[ \t]/.test(text[blockStart - 1])) {
      blockStart -= 1;
    }
    if (blockStart > cursor && /[\r\n]/.test(text[blockStart - 1])) {
      blockStart -= 1;
    }

    result += text.slice(cursor, blockStart);

    let depth = 0;
    let blockEnd = modelStart;
    for (; blockEnd < text.length; blockEnd += 1) {
      if (text[blockEnd] === "(") {
        depth += 1;
      } else if (text[blockEnd] === ")") {
        depth -= 1;
        if (depth === 0) {
          blockEnd += 1;
          break;
        }
      }
    }

    cursor = blockEnd;
  }

  return result.replace(/\n{3,}/g, "\n\n");
}

function getMouserAuthenticationErrorMessage() {
  return "Mouser/SamacSys download requires you to be signed in before CAD files can be downloaded.";
}

async function fetchMouserZipArchive(fetchImpl, metadata) {
  const body = buildQueryString(metadata.zipFormInputs || {});
  const method = String(metadata.zipMethod || "GET").toUpperCase();
  const requestUrl =
    method === "GET" && body ? `${metadata.zipActionUrl}?${body}` : metadata.zipActionUrl;
  const requestOptions = {
    method,
    credentials: "include"
  };

  if (method !== "GET") {
    requestOptions.headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    };
    requestOptions.body = body;
  }

  const response = await fetchImpl(requestUrl, requestOptions);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(getMouserAuthenticationErrorMessage());
    }
    throw new Error(`SamacSys ZIP request failed: ${response.status}`);
  }

  return ensureZipPayload(await response.arrayBuffer());
}

async function fetchMouserWrlModel(fetchImpl, partId, baseUrl = DEFAULT_SAMACSYS_BASE_URL) {
  const response = await fetchImpl(`${baseUrl}/3D/0/${partId}.wrl`, {
    credentials: "include"
  });
  if (!response.ok) {
    return null;
  }
  return response.text();
}

export {
  basenameFromZipPath,
  buildMouserPreviewResponse,
  extractSamacsysKiCadAssets,
  fetchMouserSamacsysPageMetadata,
  fetchMouserWrlModel,
  fetchMouserZipArchive,
  filenameWithoutExtension,
  getMouserAuthenticationErrorMessage,
  parseSamacsysPageMetadata,
  rewriteSamacsysFootprintModelPath,
  rewriteSamacsysSymbolFootprintReference,
  stripKicadFootprintModels
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
