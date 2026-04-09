/*
 * This background service worker handles provider-aware preview and export
 * flows. EasyEDA parts are converted locally, while Mouser/SamacSys parts use
 * pre-generated KiCad assets from the upstream ZIP download.
 */

import { convertEasyedaCadToKicad, convertObjToWrlString } from "./kicad_converter.js";
import { readZipEntries } from "./vendor/zip_reader.js";

const EASYEDA_PROVIDER = "easyedaLcsc";
const MOUSER_PROVIDER = "mouserSamacsys";

// EasyEDA endpoints for CAD data and 3D model assets.
const EASYEDA_API_ENDPOINT =
  "https://easyeda.com/api/products/{lcscId}/components?version=6.4.19.5";
const EASYEDA_MODEL_OBJ_ENDPOINT = "https://modules.easyeda.com/3dmodel/{uuid}";
const EASYEDA_MODEL_STEP_ENDPOINT =
  "https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{uuid}";

const MOUSER_COMPONENTSEARCH_BASE_URL = "https://ms.componentsearchengine.com";
const MOUSER_WRL_ENDPOINT = `${MOUSER_COMPONENTSEARCH_BASE_URL}/3D/0/{partId}.wrl`;

// Default settings for download behavior.
const DEFAULT_LIBRARY_DOWNLOAD_ROOT = "easyEDADownloader";
const DEFAULT_SETTINGS = {
  downloadIndividually: false,
  libraryDownloadRoot: DEFAULT_LIBRARY_DOWNLOAD_ROOT
};

function normalizeLibraryDownloadRoot(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  }
  if (
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    raw.startsWith("\\\\") ||
    /^[a-zA-Z]:/.test(raw)
  ) {
    return DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  }

  const normalized = raw.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  }

  return normalized;
}

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

function isFirefoxRuntime() {
  return /firefox/i.test(String(globalThis.navigator?.userAgent || ""));
}

function isBlockedPartContext(partContext) {
  return partContext?.provider === MOUSER_PROVIDER && isFirefoxRuntime();
}

function getBlockedPartContextError(partContext) {
  if (isBlockedPartContext(partContext)) {
    return "Mouser/SamacSys downloads require a proxy in Firefox. Chrome-only for now.";
  }
  return "";
}

// Load user settings from extension storage.
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to load settings:", chrome.runtime.lastError);
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

// Build KiCad library paths relative to the user's Downloads directory.
function buildLibraryPaths(libraryDownloadRoot = DEFAULT_LIBRARY_DOWNLOAD_ROOT) {
  const libraryName = libraryDownloadRoot.split("/").pop() || DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  return {
    symbolFile: `${libraryDownloadRoot}/${libraryName}.kicad_sym`,
    footprintDir: `${libraryDownloadRoot}/${libraryName}.pretty`,
    modelDir: `${libraryDownloadRoot}/${libraryName}.3dshapes`
  };
}

const activeDownloadUrls = new Map();
const canUseBlobUrl =
  typeof URL !== "undefined" &&
  typeof URL.createObjectURL === "function" &&
  typeof Blob !== "undefined";

function sanitizeFilenamePart(value, fallback = "datasheet") {
  const sanitized = String(value || "").trim().replace(/[^\w.-]+/g, "_");
  return sanitized || fallback;
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return url;
}

function ensureAbsoluteUrl(url, origin = MOUSER_COMPONENTSEARCH_BASE_URL) {
  if (!url) {
    return "";
  }
  return new URL(url, origin).toString();
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.state?.current) {
    return;
  }
  if (delta.state.current !== "complete" && delta.state.current !== "interrupted") {
    return;
  }
  const url = activeDownloadUrls.get(delta.id);
  if (url) {
    URL.revokeObjectURL(url);
    activeDownloadUrls.delete(delta.id);
  }
});

// Convert an ArrayBuffer to base64 for data URLs.
function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Convert a string to base64 for data URLs.
function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function makeSvgDataUrl(svgText) {
  return svgText
    ? `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`
    : null;
}

function makeBase64DataUrl(mimeType, base64Text) {
  if (!base64Text) {
    return null;
  }
  return `data:${mimeType};base64,${base64Text}`;
}

// Download a Blob URL so Firefox doesn't block data: URLs.
function downloadBlobUrl(filename, blob, conflictAction) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: conflictAction || "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          URL.revokeObjectURL(url);
          reject(
            new Error(
              chrome.runtime.lastError?.message || "Download failed to start."
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

// Download a text file by creating a Blob URL or data URL fallback.
async function downloadTextFile(filename, text, mimeType, conflictAction) {
  if (canUseBlobUrl) {
    const blob = new Blob([text], { type: mimeType });
    await downloadBlobUrl(filename, blob, conflictAction);
    return;
  }
  const base64 = textToBase64(text);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: conflictAction || "uniquify"
  });
}

// Download a binary file by creating a Blob URL or data URL fallback.
async function downloadBinaryFile(filename, buffer, mimeType, conflictAction) {
  if (canUseBlobUrl) {
    const blob = new Blob([buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)], {
      type: mimeType
    });
    await downloadBlobUrl(filename, blob, conflictAction);
    return;
  }
  const base64 = arrayBufferToBase64(buffer);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: conflictAction || "uniquify"
  });
}

// Download a remote URL directly into the user's Downloads directory.
async function downloadUrlFile(filename, url, conflictAction) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: conflictAction || "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          reject(
            new Error(
              chrome.runtime.lastError?.message || "Download failed to start."
            )
          );
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

// Fetch the EasyEDA CAD payload for the given LCSC id.
async function fetchCadData(lcscId) {
  const response = await fetch(EASYEDA_API_ENDPOINT.replace("{lcscId}", lcscId), {
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`EasyEDA API error: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.result) {
    const preview = JSON.stringify(payload)?.slice(0, 500);
    throw new Error(
      `EasyEDA API returned no component data. Payload: ${preview}`
    );
  }
  return payload.result;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parsePoints(pointsText) {
  const raw = String(pointsText || "").trim().split(/\s+/);
  const points = [];
  for (let i = 0; i < raw.length - 1; i += 2) {
    points.push([toNumber(raw[i]), toNumber(raw[i + 1])]);
  }
  return points;
}

function pointsToSvg(points) {
  return points.map((point) => point.join(",")).join(" ");
}

function buildSvgDocument(viewBox, body, options = {}) {
  const { background, stroke = "#111827" } = options;
  const bgRect = background
    ? `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${background}" />`
    : "";
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMidYMid meet">
  ${bgRect}
  <g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    ${body}
  </g>
</svg>`.trim();
}

function buildSymbolPreviewSvg(cadData) {
  const dataStr = cadData?.dataStr;
  if (!dataStr) {
    return null;
  }
  const bbox = dataStr.BBox || { x: 0, y: 0, width: 120, height: 80 };
  const pad = 5;
  const viewBox = {
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: bbox.width + pad * 2,
    height: bbox.height + pad * 2
  };
  const shapes = dataStr.shape || [];
  const svgParts = [];

  for (const line of shapes) {
    const designator = line.split("~")[0];
    if (designator === "P") {
      const segments = line.split("^^");
      const pinPathFields = (segments[2] || "").split("~");
      const pinDotFields = (segments[5] || "").split("~");
      const pinPath = String(pinPathFields[0] || "").trim();
      if (pinPath) {
        svgParts.push(`<path d="${pinPath}" stroke-width="1" />`);
      }
      if (pinDotFields[0] === "show") {
        const cx = toNumber(pinDotFields[1]);
        const cy = toNumber(pinDotFields[2]);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="2" fill="#111827" stroke="none" />`);
      }
    } else if (designator === "R") {
      const fields = line.split("~").slice(1);
      const x = toNumber(fields[0]);
      const y = toNumber(fields[1]);
      const width = toNumber(fields[4]);
      const height = toNumber(fields[5]);
      svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke-width="1" />`);
    } else if (designator === "PL" || designator === "PG") {
      const fields = line.split("~").slice(1);
      const points = pointsToSvg(parsePoints(fields[0]));
      const tag = designator === "PG" ? "polygon" : "polyline";
      svgParts.push(`<${tag} points="${points}" stroke-width="1" />`);
    } else if (designator === "C") {
      const fields = line.split("~").slice(1);
      const cx = toNumber(fields[0]);
      const cy = toNumber(fields[1]);
      const radius = toNumber(fields[2]);
      svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" stroke-width="1" />`);
    } else if (designator === "A") {
      const fields = line.split("~").slice(1);
      const path = String(fields[0] || "").trim();
      if (path) {
        svgParts.push(`<path d="${path}" stroke-width="1" />`);
      }
    }
  }

  return buildSvgDocument(viewBox, svgParts.join("\n"));
}

function buildFootprintPreviewSvg(cadData) {
  const dataStr = cadData?.packageDetail?.dataStr;
  if (!dataStr) {
    return null;
  }
  const bbox = dataStr.BBox || { x: 0, y: 0, width: 120, height: 120 };
  const pad = 8;
  const viewBox = {
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: bbox.width + pad * 2,
    height: bbox.height + pad * 2
  };
  const shapes = dataStr.shape || [];
  const svgParts = [];

  for (const line of shapes) {
    const parts = line.split("~");
    const designator = parts[0];
    const fields = parts.slice(1);

    if (designator === "PAD") {
      const shape = fields[0];
      const centerX = toNumber(fields[1]);
      const centerY = toNumber(fields[2]);
      const width = toNumber(fields[3]);
      const height = toNumber(fields[4]);
      const points = String(fields[9] || "").trim();
      const rotation = toNumber(fields[10]);
      const holeRadius = toNumber(fields[8]);
      if (points) {
        const polygon = pointsToSvg(parsePoints(points));
        svgParts.push(`<polygon points="${polygon}" fill="#0f172a" stroke="none" />`);
      } else if (shape === "ELLIPSE" || shape === "OVAL") {
        svgParts.push(
          `<ellipse cx="${centerX}" cy="${centerY}" rx="${width / 2}" ry="${height / 2}" fill="#0f172a" stroke="none" />`
        );
      } else {
        const x = centerX - width / 2;
        const y = centerY - height / 2;
        const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#0f172a" stroke="none"`;
        if (rotation) {
          svgParts.push(`${rect} transform="rotate(${rotation} ${centerX} ${centerY})" />`);
        } else {
          svgParts.push(`${rect} />`);
        }
      }
      if (holeRadius > 0) {
        svgParts.push(
          `<circle cx="${centerX}" cy="${centerY}" r="${holeRadius}" fill="#f8fafc" stroke="#0f172a" stroke-width="0.4" />`
        );
      }
    } else if (designator === "TRACK") {
      const strokeWidth = toNumber(fields[0], 0.2);
      const points = pointsToSvg(parsePoints(fields[3]));
      if (points) {
        svgParts.push(`<polyline points="${points}" stroke-width="${strokeWidth}" />`);
      }
    } else if (designator === "CIRCLE") {
      const cx = toNumber(fields[0]);
      const cy = toNumber(fields[1]);
      const radius = toNumber(fields[2]);
      const strokeWidth = toNumber(fields[3], 0.2);
      svgParts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" stroke-width="${strokeWidth}" />`
      );
    } else if (designator === "ARC") {
      const strokeWidth = toNumber(fields[0], 0.2);
      const path = String(fields[3] || "").trim();
      if (path) {
        svgParts.push(`<path d="${path}" stroke-width="${strokeWidth}" />`);
      }
    } else if (designator === "RECT") {
      const x = toNumber(fields[0]);
      const y = toNumber(fields[1]);
      const width = toNumber(fields[2]);
      const height = toNumber(fields[3]);
      const strokeWidth = toNumber(fields[4], 0.2);
      svgParts.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke-width="${strokeWidth}" />`
      );
    }
  }

  return buildSvgDocument(viewBox, svgParts.join("\n"), { background: "#f8fafc" });
}

// Extract the symbol block from a full KiCad symbol library file.
function extractSymbolBlock(kicadLibraryText) {
  const start = kicadLibraryText.indexOf("(symbol \"");
  if (start === -1) {
    return null;
  }
  const end = kicadLibraryText.lastIndexOf("\n)");
  if (end === -1 || end <= start) {
    return null;
  }
  return kicadLibraryText.slice(start, end).trim();
}

// Append a symbol block to an existing library, preserving the header/footer.
function mergeSymbolIntoLibrary(existingLibrary, symbolBlock, symbolId) {
  if (!symbolBlock) {
    return existingLibrary;
  }
  if (!existingLibrary) {
    return `(kicad_symbol_lib\n  (version 20211014)\n  (generator "easy EDA downloader")\n  ${symbolBlock.replace(/\n/g, "\n  ")}\n)\n`;
  }
  if (existingLibrary.includes(`(symbol "${symbolId}"`)) {
    return existingLibrary;
  }
  const trimmed = existingLibrary.trimEnd();
  const lastClose = trimmed.lastIndexOf(")");
  if (lastClose === -1) {
    return existingLibrary;
  }
  const before = trimmed.slice(0, lastClose).trimEnd();
  const indentedBlock = `  ${symbolBlock.replace(/\n/g, "\n  ")}`;
  return `${before}\n${indentedBlock}\n)\n`;
}

// Load a stored symbol library from extension storage.
async function loadStoredSymbolLibrary(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [key]: "" }, (data) => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to load symbol library:", chrome.runtime.lastError);
        resolve("");
        return;
      }
      resolve(String(data[key] || ""));
    });
  });
}

// Save a symbol library into extension storage for future appends.
async function saveStoredSymbolLibrary(key, content) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: content }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to save symbol library:", chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

// Parse footprint shapes to locate a 3D model reference (uuid + name).
function find3dModelInfo(packageDetail) {
  const shapes = packageDetail?.dataStr?.shape || [];
  for (const line of shapes) {
    const [designator, rawJson] = line.split("~");
    if (designator !== "SVGNODE" || !rawJson) {
      continue;
    }
    try {
      const attrs = JSON.parse(rawJson).attrs;
      if (attrs?.uuid) {
        return { uuid: attrs.uuid, name: attrs.title || attrs.uuid };
      }
    } catch (error) {
      console.warn("Failed to parse 3D model metadata:", error);
    }
  }
  return null;
}

function getDatasheetInfo(cadData, lcscId) {
  const rawUrl = [
    cadData?.packageDetail?.dataStr?.head?.c_para?.link,
    cadData?.dataStr?.head?.c_para?.link,
    cadData?.lcsc?.url
  ].find((value) => String(value || "").trim());
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { url: "", filename: "" };
  }

  let extension = ".pdf";
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop() || "";
    const match = lastSegment.match(/(\.[a-zA-Z0-9]{1,8})$/);
    if (match) {
      extension = match[1];
    }
  } catch (error) {
    console.warn("Failed to parse datasheet URL:", error);
  }

  const baseName = sanitizeFilenamePart(
    cadData?.packageDetail?.title ||
      cadData?.dataStr?.head?.c_para?.package ||
      cadData?.title ||
      lcscId,
    lcscId
  );

  return {
    url,
    filename: `${baseName}-datasheet${extension}`
  };
}

function ensureEasyedaLcscId(partContext) {
  const lcscId = partContext?.lookup?.lcscId;
  if (!lcscId) {
    throw new Error("No LCSC part number found on the page.");
  }
  return lcscId;
}

async function buildEasyedaPreviewResponse(partContext) {
  const lcscId = ensureEasyedaLcscId(partContext);
  const cadData = await fetchCadData(lcscId);
  return {
    previews: {
      symbolUrl: makeSvgDataUrl(buildSymbolPreviewSvg(cadData)),
      footprintUrl: makeSvgDataUrl(buildFootprintPreviewSvg(cadData))
    },
    metadata: {
      datasheetAvailable: Boolean(getDatasheetInfo(cadData, lcscId).url)
    }
  };
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

function buildMouserPreviewPageUrl(partId) {
  return `${MOUSER_COMPONENTSEARCH_BASE_URL}/preview_newDesign.php?o3=0&partID=${encodeURIComponent(partId)}&ev=0&fmt=zip&pna=Mouser`;
}

function parseSamacsysPageMetadata(html, finalUrl) {
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
    zipActionUrl: ensureAbsoluteUrl(zipForm.action),
    zipMethod: String(zipForm.method || "GET").toUpperCase(),
    zipFormInputs: {
      ...zipForm.inputs,
      tok: token,
      partID: zipForm.inputs.partID || partId,
      fmt: zipForm.inputs.fmt || "zip"
    }
  };
}

async function fetchMouserSamacsysPageMetadata(partContext) {
  const entryUrl = partContext?.lookup?.entryUrl;
  if (!entryUrl) {
    throw new Error("Mouser SamacSys entry URL was not found on the page.");
  }

  const response = await fetch(entryUrl, {
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

  const previewPageUrl = buildMouserPreviewPageUrl(partId);
  const previewResponse = await fetch(previewPageUrl, {
    credentials: "include",
    headers: {
      Accept: "text/html"
    }
  });
  if (!previewResponse.ok) {
    throw new Error(`SamacSys preview page request failed: ${previewResponse.status}`);
  }

  const previewHtml = await previewResponse.text();
  return parseSamacsysPageMetadata(previewHtml, previewResponse.url || previewPageUrl);
}

async function fetchSamacsysPreview(url) {
  const response = await fetch(url, {
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

async function buildMouserPreviewResponse(partContext) {
  const metadata = await fetchMouserSamacsysPageMetadata(partContext);
  const symbolUrl = `${MOUSER_COMPONENTSEARCH_BASE_URL}/symbol.php?scale=4&format=JSON&partID=${encodeURIComponent(metadata.partId)}&showKeepout=0&u=0&tok=${encodeURIComponent(metadata.token)}`;
  const footprintUrl = `${MOUSER_COMPONENTSEARCH_BASE_URL}/footprint.php?scale=100&format=JSON&partID=${encodeURIComponent(metadata.partId)}&showKeepout=0&u=0&tok=${encodeURIComponent(metadata.token)}&sz=N`;

  const [symbolImage, footprintImage] = await Promise.all([
    fetchSamacsysPreview(symbolUrl),
    fetchSamacsysPreview(footprintUrl)
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

async function extractSamacsysKiCadAssets(zipBuffer) {
  const entries = await readZipEntries(zipBuffer);
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

function parseKicadSymbolName(symbolLibraryText) {
  const match = String(symbolLibraryText || "").match(/\(symbol "([^"]+)"/);
  return match ? match[1] : null;
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

async function fetchMouserZipArchive(metadata) {
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

  const response = await fetch(requestUrl, requestOptions);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(getMouserAuthenticationErrorMessage());
    }
    throw new Error(`SamacSys ZIP request failed: ${response.status}`);
  }

  return ensureZipPayload(await response.arrayBuffer());
}

async function fetchMouserWrlModel(partId) {
  const response = await fetch(MOUSER_WRL_ENDPOINT.replace("{partId}", partId), {
    credentials: "include"
  });
  if (!response.ok) {
    return null;
  }
  return response.text();
}

async function exportEasyedaPart(partContext, options = {}) {
  const lcscId = ensureEasyedaLcscId(partContext);
  const settings = await loadSettings();
  const libraryPaths = buildLibraryPaths(settings.libraryDownloadRoot);
  const symbolLibraryKey = `symbolLibrary:${libraryPaths.symbolFile}`;

  const resolvedOptions = {
    symbol: options.symbol !== false,
    footprint: options.footprint !== false,
    model3d: options.model3d !== false,
    datasheet: options.datasheet === true
  };

  let downloadCount = 0;
  const warnings = [];

  if (
    !resolvedOptions.symbol &&
    !resolvedOptions.footprint &&
    !resolvedOptions.model3d &&
    !resolvedOptions.datasheet
  ) {
    throw new Error("No download options selected.");
  }

  const cadData = await fetchCadData(lcscId);
  const datasheetInfo = getDatasheetInfo(cadData, lcscId);
  const kicadFiles = convertEasyedaCadToKicad(cadData, {
    symbol: resolvedOptions.symbol,
    footprint: resolvedOptions.footprint
  });

  if (kicadFiles.symbol) {
    if (settings.downloadIndividually) {
      await downloadTextFile(
        `${lcscId}-${kicadFiles.symbol.name}.kicad_sym`,
        kicadFiles.symbol.content,
        "application/octet-stream"
      );
      downloadCount += 1;
    } else {
      const symbolBlock = extractSymbolBlock(kicadFiles.symbol.content);
      const existingLibrary = await loadStoredSymbolLibrary(symbolLibraryKey);
      const mergedLibrary = mergeSymbolIntoLibrary(
        existingLibrary || kicadFiles.symbol.content,
        symbolBlock,
        kicadFiles.symbol.name
      );
      await saveStoredSymbolLibrary(symbolLibraryKey, mergedLibrary);
      await downloadTextFile(
        libraryPaths.symbolFile,
        mergedLibrary,
        "application/octet-stream",
        "overwrite"
      );
      downloadCount += 1;
    }
  }

  if (kicadFiles.footprint) {
    if (settings.downloadIndividually) {
      await downloadTextFile(
        `${kicadFiles.footprint.name}.kicad_mod`,
        kicadFiles.footprint.content,
        "application/octet-stream"
      );
      downloadCount += 1;
    } else {
      await downloadTextFile(
        `${libraryPaths.footprintDir}/${kicadFiles.footprint.name}.kicad_mod`,
        kicadFiles.footprint.content,
        "application/octet-stream"
      );
      downloadCount += 1;
    }
  }

  if (resolvedOptions.model3d) {
    const modelInfo = find3dModelInfo(cadData.packageDetail);
    if (modelInfo) {
      const safeModelName = modelInfo.name.replace(/[^\w.-]+/g, "_");
      const stepResponse = await fetch(
        EASYEDA_MODEL_STEP_ENDPOINT.replace("{uuid}", modelInfo.uuid)
      );
      if (stepResponse.ok) {
        const stepData = await stepResponse.arrayBuffer();
        await downloadBinaryFile(
          settings.downloadIndividually
            ? `${safeModelName}.step`
            : `${libraryPaths.modelDir}/${safeModelName}.step`,
          stepData,
          "application/octet-stream"
        );
        downloadCount += 1;
      } else {
        console.warn("3D STEP download failed:", stepResponse.status);
      }

      const objResponse = await fetch(
        EASYEDA_MODEL_OBJ_ENDPOINT.replace("{uuid}", modelInfo.uuid)
      );
      if (objResponse.ok) {
        const objData = await objResponse.text();
        const wrlData = convertObjToWrlString(objData);
        await downloadTextFile(
          settings.downloadIndividually
            ? `${safeModelName}.wrl`
            : `${libraryPaths.modelDir}/${safeModelName}.wrl`,
          wrlData,
          "application/octet-stream"
        );
        downloadCount += 1;
      } else {
        console.warn("3D OBJ download failed:", objResponse.status);
      }
    }
  }

  if (resolvedOptions.datasheet) {
    if (!datasheetInfo.url) {
      warnings.push("Datasheet not available for this part.");
    } else {
      try {
        await downloadUrlFile(
          settings.downloadIndividually
            ? datasheetInfo.filename
            : `${settings.libraryDownloadRoot}/${datasheetInfo.filename}`,
          datasheetInfo.url
        );
        downloadCount += 1;
      } catch (error) {
        console.warn("Datasheet download failed:", error);
        warnings.push("Datasheet download failed.");
      }
    }
  }

  return { warnings, downloadCount };
}

async function exportMouserPart(partContext, options = {}) {
  const settings = await loadSettings();
  const libraryPaths = buildLibraryPaths(settings.libraryDownloadRoot);
  const symbolLibraryKey = `symbolLibrary:${libraryPaths.symbolFile}`;
  const resolvedOptions = {
    symbol: options.symbol !== false,
    footprint: options.footprint !== false,
    model3d: options.model3d !== false,
    datasheet: options.datasheet === true
  };

  let downloadCount = 0;
  const warnings = [];

  if (
    !resolvedOptions.symbol &&
    !resolvedOptions.footprint &&
    !resolvedOptions.model3d &&
    !resolvedOptions.datasheet
  ) {
    throw new Error("No download options selected.");
  }

  if (resolvedOptions.datasheet) {
    warnings.push("Datasheet export is not available for Mouser SamacSys parts.");
  }

  const metadata = await fetchMouserSamacsysPageMetadata(partContext);
  const zipBuffer = await fetchMouserZipArchive(metadata);
  const assets = await extractSamacsysKiCadAssets(zipBuffer);
  const libraryName =
    libraryPaths.symbolFile.split("/").pop()?.replace(/\.kicad_sym$/, "") ||
    DEFAULT_LIBRARY_DOWNLOAD_ROOT;
  const primaryFootprintName = assets.footprints[0]?.name || null;
  const primaryStepFilename = assets.stepModels[0]?.filename || null;
  const shouldIncludeModelReferences = resolvedOptions.model3d && primaryStepFilename;

  if (resolvedOptions.symbol) {
    for (const symbol of assets.symbols) {
      const rewrittenSymbol = settings.downloadIndividually
        ? symbol.content
        : rewriteSamacsysSymbolFootprintReference(
            symbol.content,
            primaryFootprintName,
            libraryName
          );

      if (settings.downloadIndividually) {
        await downloadTextFile(
          symbol.filename,
          rewrittenSymbol,
          "application/octet-stream"
        );
        downloadCount += 1;
        continue;
      }

      const symbolBlock = extractSymbolBlock(rewrittenSymbol);
      const symbolName = parseKicadSymbolName(rewrittenSymbol) || symbol.name;
      const existingLibrary = await loadStoredSymbolLibrary(symbolLibraryKey);
      const mergedLibrary = mergeSymbolIntoLibrary(
        existingLibrary || rewrittenSymbol,
        symbolBlock,
        symbolName
      );
      await saveStoredSymbolLibrary(symbolLibraryKey, mergedLibrary);
      await downloadTextFile(
        libraryPaths.symbolFile,
        mergedLibrary,
        "application/octet-stream",
        "overwrite"
      );
      downloadCount += 1;
    }
  }

  if (resolvedOptions.footprint) {
    for (const footprint of assets.footprints) {
      let footprintContent = stripKicadFootprintModels(footprint.content);
      if (shouldIncludeModelReferences) {
        footprintContent = settings.downloadIndividually
          ? footprint.content
          : rewriteSamacsysFootprintModelPath(
              footprint.content,
              primaryStepFilename,
              libraryName
            );
      }

      if (settings.downloadIndividually) {
        await downloadTextFile(
          footprint.filename,
          footprintContent,
          "application/octet-stream"
        );
        downloadCount += 1;
      } else {
        await downloadTextFile(
          `${libraryPaths.footprintDir}/${footprint.filename}`,
          footprintContent,
          "application/octet-stream"
        );
        downloadCount += 1;
      }
    }
  }

  if (resolvedOptions.model3d) {
    for (const stepModel of assets.stepModels) {
      await downloadBinaryFile(
        settings.downloadIndividually
          ? stepModel.filename
          : `${libraryPaths.modelDir}/${stepModel.filename}`,
        stepModel.data,
        "application/octet-stream"
      );
      downloadCount += 1;
    }

    for (const wrlModel of assets.wrlModels) {
      await downloadTextFile(
        settings.downloadIndividually
          ? wrlModel.filename
          : `${libraryPaths.modelDir}/${wrlModel.filename}`,
        wrlModel.content,
        "application/octet-stream"
      );
      downloadCount += 1;
    }

    if (!assets.wrlModels.length) {
      const remoteWrl = await fetchMouserWrlModel(metadata.partId);
      if (remoteWrl) {
        const wrlFilename = `${filenameWithoutExtension(
          primaryStepFilename || metadata.partId
        )}.wrl`;
        await downloadTextFile(
          settings.downloadIndividually
            ? wrlFilename
            : `${libraryPaths.modelDir}/${wrlFilename}`,
          remoteWrl,
          "application/octet-stream"
        );
        downloadCount += 1;
      } else {
        warnings.push("SamacSys WRL model not available for this part.");
      }
    }
  }

  return { warnings, downloadCount };
}

async function getPartPreviews(partContext) {
  const normalizedPartContext = normalizePartContext(partContext);
  if (!normalizedPartContext) {
    throw new Error("No supported part found on the page.");
  }

  const blockedError = getBlockedPartContextError(normalizedPartContext);
  if (blockedError) {
    throw new Error(blockedError);
  }

  if (normalizedPartContext.provider === EASYEDA_PROVIDER) {
    return buildEasyedaPreviewResponse(normalizedPartContext);
  }
  if (normalizedPartContext.provider === MOUSER_PROVIDER) {
    return buildMouserPreviewResponse(normalizedPartContext);
  }

  throw new Error("Unsupported provider.");
}

async function exportPart(partContext, options = {}) {
  const normalizedPartContext = normalizePartContext(partContext);
  if (!normalizedPartContext) {
    throw new Error("No supported part found on the page.");
  }

  const blockedError = getBlockedPartContextError(normalizedPartContext);
  if (blockedError) {
    throw new Error(blockedError);
  }

  if (normalizedPartContext.provider === EASYEDA_PROVIDER) {
    return exportEasyedaPart(normalizedPartContext, options);
  }
  if (normalizedPartContext.provider === MOUSER_PROVIDER) {
    return exportMouserPart(normalizedPartContext, options);
  }

  throw new Error("Unsupported provider.");
}

// Listen for UI requests to preview or export the current part.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PART_PREVIEWS") {
    getPartPreviews(message.partContext)
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
    exportPart(message.partContext, message.options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("easy EDA downloader extension error:", error);
        sendResponse({ ok: false, error: error?.message || "Download failed." });
      });
    return true;
  }

  return false;
});
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
