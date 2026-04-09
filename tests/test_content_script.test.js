import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { runSourceFile } from "./helpers/test_harness.js";

function loadContentScript(markup) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
    url: "https://example.test/"
  });
  const listeners = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    }
  };

  const context = runSourceFile("src/content_script.js", {
    context: {
      chrome,
      document: dom.window.document,
      window: dom.window
    },
    append: `
globalThis.__testExports = {
  normalizeLabel,
  extractLcscId,
  extractManufacturerPartNumber,
  findInDefinitionLists,
  findInTables,
  findLcscId,
  findManufacturerPartNumberInDefinitionLists,
  findManufacturerPartNumberInTables,
  findManufacturerPartNumber,
  parseLoadPartDivCall,
  buildMouserEntryUrl,
  findMouserPartContext,
  findEasyedaPartContext,
  findPartContext
};
`
  });

  return {
    hooks: context.__testExports,
    listener: listeners[0]
  };
}

describe("content script", () => {
  it("normalizes labels and extracts LCSC ids from text", () => {
    const { hooks } = loadContentScript("<div>ignored</div>");

    expect(hooks.normalizeLabel("  LCSC   Part #  ")).toBe("lcsc part #");
    expect(hooks.extractLcscId("Match c123456 here")).toBe("C123456");
    expect(hooks.extractManufacturerPartNumber("  TPS62177DQCR  ")).toBe(
      "TPS62177DQCR"
    );
    expect(hooks.extractLcscId("No part id")).toBeNull();
  });

  it("detects EasyEDA/LCSC part context and answers extension messages", () => {
    const { hooks, listener } = loadContentScript(`
      <section>
        Product details mention c777888 in plain text.
      </section>
      <dl>
        <dt>Mfr. Part #</dt>
        <dd>STM32F030F4P6</dd>
      </dl>
    `);

    expect(hooks.findLcscId()).toBe("C777888");
    expect(hooks.findManufacturerPartNumber()).toBe("STM32F030F4P6");
    expect(hooks.findEasyedaPartContext()).toEqual({
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
      sourcePartNumber: "C777888",
      manufacturerPartNumber: "STM32F030F4P6",
      lookup: {
        lcscId: "C777888"
      }
    });

    const sendResponse = vi.fn();
    expect(listener({ type: "GET_PART_CONTEXT" }, null, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
      sourcePartNumber: "C777888",
      manufacturerPartNumber: "STM32F030F4P6",
      lookup: {
        lcscId: "C777888"
      }
    });
  });

  it("returns a null manufacturer part number when only the LCSC identifier is present", () => {
    const { hooks, listener } = loadContentScript(`
      <table class="tableInfoWrap">
        <tr>
          <td>LCSC Part #</td>
          <td>C424242</td>
        </tr>
      </table>
    `);

    expect(hooks.findInTables()).toBe("C424242");
    expect(hooks.findManufacturerPartNumber()).toBeNull();

    const sendResponse = vi.fn();
    listener({ type: "GET_PART_CONTEXT" }, null, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
      sourcePartNumber: "C424242",
      manufacturerPartNumber: null,
      lookup: {
        lcscId: "C424242"
      }
    });
  });

  it("detects a Mouser SamacSys part context from the ECAD button and DOM metadata", () => {
    const { hooks } = loadContentScript(`
      <div class="row">
        <label for="MouserPartNumFormattedForProdInfo">Mouser No:</label>
        <div id="divMouserPartNum">
          <span id="spnMouserPartNumFormattedForProdInfo">511-STM32U3C5RIT6Q</span>
          <input
            id="MouserPartNumFormattedForProdInfo"
            value="511-STM32U3C5RIT6Q"
          />
        </div>
      </div>
      <div class="row">
        <label for="ManufacturerPartNumber">Mfr. No:</label>
        <div>
          <span id="spnManufacturerPartNumber">STM32U3C5RIT6Q</span>
          <input id="ManufacturerPartNumber" value="STM32U3C5RIT6Q" />
        </div>
      </div>
      <button
        id="lnk_CadModel"
        data-testid="ProductInfoECAD"
        onclick='dataLayer.push({"event_mouserpn":"511-stm32u3c5rit6q","event_manufacturer":"stmicroelectronics","event_manufacturerpn":"stm32u3c5rit6q"}); javascript:loadPartDiv("STMicroelectronics", "STM32U3C5RIT6Q", "mouser",1,"epw", 0, "","en-GB")'
      ></button>
    `);

    expect(
      hooks.parseLoadPartDivCall(
        'javascript:loadPartDiv("STMicroelectronics", "STM32U3C5RIT6Q", "mouser",1,"epw", 0, "","en-GB")'
      )
    ).toEqual({
      manufacturerName: "STMicroelectronics",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      partnerName: "mouser",
      format: "epw",
      logo: null,
      lang: "en-GB"
    });
    expect(
      hooks.buildMouserEntryUrl({
        manufacturerName: "STMicroelectronics",
        manufacturerPartNumber: "STM32U3C5RIT6Q",
        format: "zip",
        lang: "en-GB"
      })
    ).toBe(
      "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB"
    );
    expect(hooks.findMouserPartContext()).toEqual({
      provider: "mouserSamacsys",
      sourcePartLabel: "Mouser part",
      sourcePartNumber: "511-STM32U3C5RIT6Q",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      lookup: {
        manufacturerName: "STMicroelectronics",
        entryUrl:
          "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB"
      }
    });
  });

  it("falls back to ECAD-button data for Mouser pages and returns no provider when ECAD is unavailable", () => {
    const { hooks: withEcadHooks } = loadContentScript(`
      <button
        id="lnk_CadModel"
        data-testid="ProductInfoECAD"
        onclick='dataLayer.push({"event_mouserpn":"511-stm32u3c5rit6q","event_manufacturer":"stmicroelectronics","event_manufacturerpn":"stm32u3c5rit6q"}); javascript:loadPartDiv("STMicroelectronics", "STM32U3C5RIT6Q", "mouser",1,"zip", 0, "","en-GB")'
      ></button>
    `);
    expect(withEcadHooks.findPartContext()).toEqual({
      provider: "mouserSamacsys",
      sourcePartLabel: "Mouser part",
      sourcePartNumber: "511-STM32U3C5RIT6Q",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      lookup: {
        manufacturerName: "STMicroelectronics",
        entryUrl:
          "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB"
      }
    });

    const { hooks: withoutEcadHooks } = loadContentScript(`
      <div>
        <label for="ManufacturerPartNumber">Mfr. No:</label>
        <input id="ManufacturerPartNumber" value="NO_ECAD_PART" />
      </div>
    `);
    expect(withoutEcadHooks.findMouserPartContext()).toBeNull();
    expect(withoutEcadHooks.findPartContext()).toEqual({
      provider: null,
      sourcePartLabel: null,
      sourcePartNumber: null,
      manufacturerPartNumber: null,
      lookup: null
    });
  });

  it("does not report Mouser support when the ECAD button lacks export metadata", () => {
    const { hooks } = loadContentScript(`
      <button
        id="lnk_CadModel"
        data-testid="ProductInfoECAD"
        onclick='dataLayer.push({"event_manufacturerpn":"stm32u3c5rit6q"});'
      ></button>
    `);

    expect(hooks.findMouserPartContext()).toBeNull();
    expect(hooks.findPartContext()).toEqual({
      provider: null,
      sourcePartLabel: null,
      sourcePartNumber: null,
      manufacturerPartNumber: null,
      lookup: null
    });
  });
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
