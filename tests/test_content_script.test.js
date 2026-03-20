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
  findInDefinitionLists,
  findInTables,
  findLcscId
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
    expect(hooks.extractLcscId("No part id")).toBeNull();
  });

  it("detects LCSC ids in definition lists and tables", () => {
    const { hooks } = loadContentScript(`
      <dl>
        <dt>JLCPCB Part #</dt>
        <dd>C2040</dd>
      </dl>
      <table class="tableInfoWrap">
        <tr>
          <td>LCSC Part #</td>
          <td>C9988</td>
        </tr>
      </table>
    `);

    expect(hooks.findInDefinitionLists()).toBe("C2040");
    expect(hooks.findInTables()).toBe("C9988");
  });

  it("falls back to a page-wide scan and answers extension messages", () => {
    const { hooks, listener } = loadContentScript(`
      <section>
        Product details mention c777888 in plain text.
      </section>
    `);

    expect(hooks.findLcscId()).toBe("C777888");

    const sendResponse = vi.fn();
    expect(listener({ type: "GET_LCSC_ID" }, null, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ lcscId: "C777888" });
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
