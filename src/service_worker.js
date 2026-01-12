async function getLcscIdFromTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "GET_LCSC_ID" });
}

const API_ENDPOINT =
  "https://easyeda.com/api/products/{lcscId}/components?version=6.4.19.5";
const ENDPOINT_3D_MODEL_OBJ = "https://modules.easyeda.com/3dmodel/{uuid}";
const ENDPOINT_3D_MODEL_STEP =
  "https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{uuid}";

async function downloadFile(filename, data, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
    throw new Error("EasyEDA API returned no component data.");
  }
  return payload.result;
}

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

async function exportPart(lcscId) {
  if (!lcscId) {
    throw new Error("No LCSC part number found on the page.");
  }

  const cadData = await fetchCadData(lcscId);

  await downloadFile(
    `${lcscId}-symbol.json`,
    JSON.stringify(cadData.dataStr, null, 2),
    "application/json"
  );
  await downloadFile(
    `${lcscId}-footprint.json`,
    JSON.stringify(cadData.packageDetail?.dataStr ?? {}, null, 2),
    "application/json"
  );

  const modelInfo = find3dModelInfo(cadData.packageDetail);
  if (modelInfo) {
    const stepResponse = await fetch(
      ENDPOINT_3D_MODEL_STEP.replace("{uuid}", modelInfo.uuid)
    );
    if (stepResponse.ok) {
      const stepData = await stepResponse.arrayBuffer();
      await downloadFile(
        `${lcscId}-${modelInfo.name}.step`,
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
      await downloadFile(
        `${lcscId}-${modelInfo.name}.obj`,
        objData,
        "text/plain"
      );
    } else {
      console.warn("3D OBJ download failed:", objResponse.status);
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }

  try {
    const response = await getLcscIdFromTab(tab.id);
    await exportPart(response?.lcscId);
  } catch (error) {
    console.error("easyeda2kicad extension error:", error);
  }
});
