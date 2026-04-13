/*
 * Shared provider adapter for SamacSys-backed distributor pages. Distributor-
 * specific detection happens in the content script, while this adapter owns the
 * common preview and export path for Mouser, Farnell, and similar partners.
 */

import { parseKicadSymbolName } from "../core/library_store.js";
import {
  createExportContext,
  getLibraryName,
  resolveExportOptions,
  writeBinaryArtifact,
  writeSymbolArtifact,
  writeTextArtifact
} from "../core/export_artifacts.js";
import {
  buildSamacsysPreviewResponse,
  extractSamacsysKiCadAssets,
  fetchSamacsysPageMetadata,
  fetchSamacsysWrlModel,
  fetchSamacsysZipArchive,
  filenameWithoutExtension,
  rewriteSamacsysFootprintModelPath,
  rewriteSamacsysSymbolFootprintReference,
  stripKicadFootprintModels
} from "./samacsys_common.js";

function createSamacsysDistributorAdapter(deps) {
  const { chromeApi, fetchImpl, downloads, readZipEntries } = deps;

  return {
    async getPreviews(partContext) {
      return buildSamacsysPreviewResponse(fetchImpl, partContext);
    },

    async exportPart(partContext, options = {}) {
      const exportContext = await createExportContext(chromeApi);
      const resolvedOptions = resolveExportOptions(options);

      let downloadCount = 0;
      const warnings = [];

      if (resolvedOptions.datasheet) {
        warnings.push("Datasheet export is not available for Mouser SamacSys parts.");
      }

      const metadata = await fetchSamacsysPageMetadata(fetchImpl, partContext);
      const zipBuffer = await fetchSamacsysZipArchive(fetchImpl, metadata);
      const assets = await extractSamacsysKiCadAssets(zipBuffer, readZipEntries);
      const libraryName = getLibraryName(exportContext.libraryPaths);
      const primaryFootprintName = assets.footprints[0]?.name || null;
      const primaryStepFilename = assets.stepModels[0]?.filename || null;
      const shouldIncludeModelReferences = resolvedOptions.model3d && primaryStepFilename;

      if (resolvedOptions.symbol) {
        for (const symbol of assets.symbols) {
          const rewrittenSymbol = exportContext.settings.downloadIndividually
            ? symbol.content
            : rewriteSamacsysSymbolFootprintReference(
                symbol.content,
                primaryFootprintName,
                libraryName
              );

          const symbolName = parseKicadSymbolName(rewrittenSymbol) || symbol.name;
          downloadCount += await writeSymbolArtifact({
            chromeApi,
            downloads,
            exportContext,
            symbolContent: rewrittenSymbol,
            symbolName,
            individualFilename: symbol.filename
          });
        }
      }

      if (resolvedOptions.footprint) {
        for (const footprint of assets.footprints) {
          let footprintContent = stripKicadFootprintModels(footprint.content);
          if (shouldIncludeModelReferences) {
            footprintContent = exportContext.settings.downloadIndividually
              ? footprint.content
              : rewriteSamacsysFootprintModelPath(
                  footprint.content,
                  primaryStepFilename,
                  libraryName
                );
          }

          downloadCount += await writeTextArtifact({
            downloads,
            exportContext,
            content: footprintContent,
            individualFilename: footprint.filename,
            libraryPath: `${exportContext.libraryPaths.footprintDir}/${footprint.filename}`
          });
        }
      }

      if (resolvedOptions.model3d) {
        for (const stepModel of assets.stepModels) {
          downloadCount += await writeBinaryArtifact({
            downloads,
            exportContext,
            data: stepModel.data,
            individualFilename: stepModel.filename,
            libraryPath: `${exportContext.libraryPaths.modelDir}/${stepModel.filename}`
          });
        }

        for (const wrlModel of assets.wrlModels) {
          downloadCount += await writeTextArtifact({
            downloads,
            exportContext,
            content: wrlModel.content,
            individualFilename: wrlModel.filename,
            libraryPath: `${exportContext.libraryPaths.modelDir}/${wrlModel.filename}`
          });
        }

        if (!assets.wrlModels.length) {
          const remoteWrl = await fetchSamacsysWrlModel(
            fetchImpl,
            metadata.partId,
            metadata.baseUrl
          );
          if (remoteWrl) {
            const wrlFilename = `${filenameWithoutExtension(
              primaryStepFilename || metadata.partId
            )}.wrl`;
            downloadCount += await writeTextArtifact({
              downloads,
              exportContext,
              content: remoteWrl,
              individualFilename: wrlFilename,
              libraryPath: `${exportContext.libraryPaths.modelDir}/${wrlFilename}`
            });
          } else {
            warnings.push("SamacSys WRL model not available for this part.");
          }
        }
      }

      return { warnings, downloadCount };
    }
  };
}

export { createSamacsysDistributorAdapter };

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
