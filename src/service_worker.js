/*
 * This background service worker handles the heavy lifting for the
 * extension. It fetches EasyEDA CAD data for a given LCSC id, converts it into
 * KiCad-friendly files, and triggers downloads (symbol, footprint, and 3D).
 */

import { convertEasyedaCadToKicad, convertObjToWrlString } from "./kicad_converter.js";

// Ask the active tab's content script for the LCSC part number.
async function getLcscIdFromTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "GET_LCSC_ID" });
}

// EasyEDA endpoints for CAD data and 3D model assets.
const API_ENDPOINT =
  "https://easyeda.com/api/products/{lcscId}/components?version=6.4.19.5";
const ENDPOINT_3D_MODEL_OBJ = "https://modules.easyeda.com/3dmodel/{uuid}";
const ENDPOINT_3D_MODEL_STEP =
  "https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{uuid}";

// Default settings for download behavior.
const DEFAULT_SETTINGS = {
  downloadIndividually: false
};

const DEFAULT_LIBRARY_DIR = "easyEDADownloader";

// Convert an ArrayBuffer to base64 for data URLs.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
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
            : DEFAULT_SETTINGS.downloadIndividually
      });
    });
  });
}

// Build KiCad library paths relative to the user's Downloads directory.
function buildLibraryPaths() {
  return {
    symbolFile: `${DEFAULT_LIBRARY_DIR}/${DEFAULT_LIBRARY_DIR}.kicad_sym`,
    footprintDir: `${DEFAULT_LIBRARY_DIR}/${DEFAULT_LIBRARY_DIR}.pretty`,
    modelDir: `${DEFAULT_LIBRARY_DIR}/${DEFAULT_LIBRARY_DIR}.3dshapes`
  };
}

// Download a text file by creating a data URL.
async function downloadTextFile(filename, text, mimeType, conflictAction) {
  const base64 = textToBase64(text);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: conflictAction || "uniquify"
  });
}

// Download a binary file by creating a data URL.
async function downloadBinaryFile(filename, buffer, mimeType, conflictAction) {
  const base64 = arrayBufferToBase64(buffer);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: conflictAction || "uniquify"
  });
}

// Fetch the EasyEDA CAD payload for the given LCSC id.
async function fetchCadData(lcscId) {
  const response = await fetch(API_ENDPOINT.replace("{lcscId}", lcscId), {
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

// Main workflow: fetch, convert, and download the requested assets.
async function exportPart(lcscId, options = {}) {
  if (!lcscId) {
    throw new Error("No LCSC part number found on the page.");
  }

  const settings = await loadSettings();
  const libraryPaths = buildLibraryPaths();
  const symbolLibraryKey = `symbolLibrary:${libraryPaths.symbolFile}`;

  // Default to exporting everything unless explicitly disabled.
  const resolvedOptions = {
    symbol: options.symbol !== false,
    footprint: options.footprint !== false,
    model3d: options.model3d !== false
  };

  if (
    !resolvedOptions.symbol &&
    !resolvedOptions.footprint &&
    !resolvedOptions.model3d
  ) {
    throw new Error("No download options selected.");
  }

  const cadData = await fetchCadData(lcscId);

  // Convert the EasyEDA CAD payload into KiCad symbol/footprint text.
  const kicadFiles = convertEasyedaCadToKicad(cadData, {
    symbol: resolvedOptions.symbol,
    footprint: resolvedOptions.footprint
  });

  // Download the symbol if requested.
  if (kicadFiles.symbol) {
    if (settings.downloadIndividually) {
      await downloadTextFile(
        `${lcscId}-${kicadFiles.symbol.name}.kicad_sym`,
        kicadFiles.symbol.content,
        "application/octet-stream"
      );
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
    }
  }

  // Download the footprint if requested.
  if (kicadFiles.footprint) {
    if (settings.downloadIndividually) {
      await downloadTextFile(
        `${kicadFiles.footprint.name}.kicad_mod`,
        kicadFiles.footprint.content,
        "application/octet-stream"
      );
    } else {
      await downloadTextFile(
        `${libraryPaths.footprintDir}/${kicadFiles.footprint.name}.kicad_mod`,
        kicadFiles.footprint.content,
        "application/octet-stream"
      );
    }
  }

  // Download 3D assets (STEP + OBJ -> VRML) if requested.
  if (resolvedOptions.model3d) {
    const modelInfo = find3dModelInfo(cadData.packageDetail);
    if (modelInfo) {
      const safeModelName = modelInfo.name.replace(/[^\w.-]+/g, "_");
      const stepResponse = await fetch(
        ENDPOINT_3D_MODEL_STEP.replace("{uuid}", modelInfo.uuid)
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
      } else {
        console.warn("3D STEP download failed:", stepResponse.status);
      }

      const objResponse = await fetch(
        ENDPOINT_3D_MODEL_OBJ.replace("{uuid}", modelInfo.uuid)
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
      } else {
        console.warn("3D OBJ download failed:", objResponse.status);
      }
    }
  }
}

// Listen for UI requests to export the current part.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PREVIEW_SVGS") {
    fetchCadData(message.lcscId)
      .then((cadData) => {
        sendResponse({
          ok: true,
          previews: {
            symbolSvg: buildSymbolPreviewSvg(cadData),
            footprintSvg: buildFootprintPreviewSvg(cadData)
          }
        });
      })
      .catch((error) => {
        console.error("easy EDA downloader preview error:", error);
        sendResponse({ ok: false, error: error?.message || "Preview failed." });
      });
    return true;
  }

  if (message?.type === "EXPORT_PART") {
    exportPart(message.lcscId, message.options)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("easy EDA downloader extension error:", error);
        sendResponse({ ok: false, error: error?.message || "Download failed." });
      });
    return true;
  }

  return false;
});
/*
 * This file is part of easyEdaDownloader.
 *
 * easyEdaDownloader is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This software is derived from easyeda2kicad.py by uPesy.
 */
