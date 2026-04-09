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
  findManufacturerPartNumber
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

  it("detects LCSC ids and manufacturer part numbers in definition lists and tables", () => {
    const { hooks } = loadContentScript(`
      <dl>
        <dt>Mfr. Part #</dt>
        <dd>SN74LVC1G14DBVR</dd>
      </dl>
      <dl>
        <dt>JLCPCB Part #</dt>
        <dd>C2040</dd>
      </dl>
      <table class="tableInfoWrap">
        <tr>
          <td>Mfr. Part #</td>
          <td>TPS562201DDCR</td>
        </tr>
        <tr>
          <td>LCSC Part #</td>
          <td>C9988</td>
        </tr>
      </table>
    `);

    expect(hooks.findInDefinitionLists()).toBe("C2040");
    expect(hooks.findInTables()).toBe("C9988");
    expect(hooks.findManufacturerPartNumberInDefinitionLists()).toBe(
      "SN74LVC1G14DBVR"
    );
    expect(hooks.findManufacturerPartNumberInTables()).toBe("TPS562201DDCR");
  });

  it("falls back to a page-wide LCSC scan, keeps manufacturer targeted, and answers extension messages", () => {
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

    const sendResponse = vi.fn();
    expect(listener({ type: "GET_LCSC_ID" }, null, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      lcscId: "C777888",
      manufacturerPartNumber: "STM32F030F4P6"
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
    listener({ type: "GET_LCSC_ID" }, null, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      lcscId: "C424242",
      manufacturerPartNumber: null
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
