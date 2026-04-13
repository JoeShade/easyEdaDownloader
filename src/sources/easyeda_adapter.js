/*
 * Provider adapter for EasyEDA-backed JLCPCB/LCSC parts. It owns the EasyEDA
 * fetch/convert/export flow while delegating shared settings, library, and
 * artifact-writing behavior to the worker core helpers.
 */

import {
  buildEasyedaPreviewResponse,
  EASYEDA_MODEL_OBJ_ENDPOINT,
  EASYEDA_MODEL_STEP_ENDPOINT,
  ensureEasyedaLcscId,
  fetchCadData,
  find3dModelInfo,
  getDatasheetInfo
} from "./easyeda_common.js";
import {
  createExportContext,
  resolveExportOptions,
  writeBinaryArtifact,
  writeSymbolArtifact,
  writeTextArtifact,
  writeUrlArtifact
} from "../core/export_artifacts.js";

function createEasyedaAdapter(deps) {
  const {
    chromeApi,
    fetchImpl,
    downloads,
    convertEasyedaCadToKicad,
    convertObjToWrlString
  } = deps;

  return {
    async getPreviews(partContext) {
      return buildEasyedaPreviewResponse(fetchImpl, partContext);
    },

    async exportPart(partContext, options = {}) {
      const lcscId = ensureEasyedaLcscId(partContext);
      const exportContext = await createExportContext(chromeApi);
      const resolvedOptions = resolveExportOptions(options);

      let downloadCount = 0;
      const warnings = [];

      const cadData = await fetchCadData(fetchImpl, lcscId);
      const datasheetInfo = getDatasheetInfo(cadData, lcscId);
      const kicadFiles = convertEasyedaCadToKicad(cadData, {
        symbol: resolvedOptions.symbol,
        footprint: resolvedOptions.footprint
      });

      if (kicadFiles.symbol) {
        downloadCount += await writeSymbolArtifact({
          chromeApi,
          downloads,
          exportContext,
          symbolContent: kicadFiles.symbol.content,
          symbolName: kicadFiles.symbol.name,
          individualFilename: `${lcscId}-${kicadFiles.symbol.name}.kicad_sym`
        });
      }

      if (kicadFiles.footprint) {
        downloadCount += await writeTextArtifact({
          downloads,
          exportContext,
          content: kicadFiles.footprint.content,
          individualFilename: `${kicadFiles.footprint.name}.kicad_mod`,
          libraryPath: `${exportContext.libraryPaths.footprintDir}/${kicadFiles.footprint.name}.kicad_mod`
        });
      }

      if (resolvedOptions.model3d) {
        const modelInfo = find3dModelInfo(cadData.packageDetail);
        if (modelInfo) {
          const safeModelName = modelInfo.name.replace(/[^\w.-]+/g, "_");
          const stepResponse = await fetchImpl(
            EASYEDA_MODEL_STEP_ENDPOINT.replace("{uuid}", modelInfo.uuid)
          );
          if (stepResponse.ok) {
            const stepData = await stepResponse.arrayBuffer();
            downloadCount += await writeBinaryArtifact({
              downloads,
              exportContext,
              data: stepData,
              individualFilename: `${safeModelName}.step`,
              libraryPath: `${exportContext.libraryPaths.modelDir}/${safeModelName}.step`
            });
          } else {
            console.warn("3D STEP download failed:", stepResponse.status);
          }

          const objResponse = await fetchImpl(
            EASYEDA_MODEL_OBJ_ENDPOINT.replace("{uuid}", modelInfo.uuid)
          );
          if (objResponse.ok) {
            const objData = await objResponse.text();
            const wrlData = convertObjToWrlString(objData);
            downloadCount += await writeTextArtifact({
              downloads,
              exportContext,
              content: wrlData,
              individualFilename: `${safeModelName}.wrl`,
              libraryPath: `${exportContext.libraryPaths.modelDir}/${safeModelName}.wrl`
            });
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
            downloadCount += await writeUrlArtifact({
              downloads,
              exportContext,
              url: datasheetInfo.url,
              individualFilename: datasheetInfo.filename,
              libraryPath: `${exportContext.settings.libraryDownloadRoot}/${datasheetInfo.filename}`
            });
          } catch (error) {
            console.warn("Datasheet download failed:", error);
            warnings.push("Datasheet download failed.");
          }
        }
      }

      return { warnings, downloadCount };
    }
  };
}

export { createEasyedaAdapter };

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
