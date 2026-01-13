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

// Download a text file by creating a data URL.
async function downloadTextFile(filename, text, mimeType) {
  const base64 = textToBase64(text);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({ url, filename });
}

// Download a binary file by creating a data URL.
async function downloadBinaryFile(filename, buffer, mimeType) {
  const base64 = arrayBufferToBase64(buffer);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({ url, filename });
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
    await downloadTextFile(
      `${lcscId}-${kicadFiles.symbol.name}.kicad_sym`,
      kicadFiles.symbol.content,
      "application/octet-stream"
    );
  }

  // Download the footprint if requested.
  if (kicadFiles.footprint) {
    await downloadTextFile(
      `${kicadFiles.footprint.name}.kicad_mod`,
      kicadFiles.footprint.content,
      "application/octet-stream"
    );
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
          `${safeModelName}.step`,
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
          `${safeModelName}.wrl`,
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
  if (message?.type !== "EXPORT_PART") {
    return false;
  }

  exportPart(message.lcscId, message.options)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("easy EDA downloader extension error:", error);
      sendResponse({ ok: false, error: error?.message || "Download failed." });
    });

  return true;
});
