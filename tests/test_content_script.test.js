/*
 * These tests cover provider-aware DOM detection in the content script. They
 * run the script in jsdom with mocked chrome messaging so page parsing can be
 * exercised without a browser extension.
 */

import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { runSourceFile } from "./helpers/test_harness.js";

function loadContentScript(
  markup,
  { url = "https://www.lcsc.com/product-detail/example", headMarkup = "" } = {}
) {
  const dom = new JSDOM(
    `<!doctype html><html><head>${headMarkup}</head><body>${markup}</body></html>`,
    {
      url
    }
  );
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
  parseLoadPartDivCall,
  buildSamacsysEntryUrl,
  parseSamacsysLinkUrl,
  findLcscId,
  findManufacturerPartNumber,
  findMouserPartContext,
  findFarnellPartContext,
  findEasyedaPartContext,
  findPartContext
};
`
  });

  return {
    dom,
    hooks: context.__testExports,
    listener: listeners[0]
  };
}

describe("content script", () => {
  it("extracts EasyEDA identifiers from supported page text", () => {
    const { hooks } = loadContentScript("<div>ignored</div>");

    expect(hooks.findLcscId()).toBeNull();
    expect(hooks.findManufacturerPartNumber()).toBeNull();
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

  it("extracts JLCPCB manufacturer part numbers from compact labels", () => {
    const { hooks } = loadContentScript(
      `
      <dl>
        <dt>MFR.Part #</dt>
        <dd>35ZLH100MEFC6.3X11</dd>
      </dl>
      <dl>
        <dt>JLCPCB Part #</dt>
        <dd>C109392</dd>
      </dl>
    `,
      {
        url: "https://jlcpcb.com/partdetail/Rubycon-35ZLH100MEFC63X11/C109392"
      }
    );

    expect(hooks.findPartContext()).toEqual({
      provider: "easyedaLcsc",
      sourcePartLabel: "LCSC part",
      sourcePartNumber: "C109392",
      manufacturerPartNumber: "35ZLH100MEFC6.3X11",
      lookup: {
        lcscId: "C109392"
      }
    });
  });

  it("detects a Mouser SamacSys part context from the ECAD button and DOM metadata", () => {
    const { hooks } = loadContentScript(
      `
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
    `,
      { url: "https://www.mouser.co.uk/ProductDetail/test" }
    );

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
      hooks.buildSamacsysEntryUrl({
        baseUrl: "https://ms.componentsearchengine.com",
        manufacturerName: "STMicroelectronics",
        manufacturerPartNumber: "STM32U3C5RIT6Q",
        partnerName: "mouser",
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
          "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB",
        partnerName: "mouser",
        samacsysBaseUrl: "https://ms.componentsearchengine.com"
      }
    });
  });

  it("falls back to ECAD-button data for Mouser pages and returns no provider when ECAD is unavailable", () => {
    const { hooks: withEcadHooks } = loadContentScript(
      `
      <button
        id="lnk_CadModel"
        data-testid="ProductInfoECAD"
        onclick='dataLayer.push({"event_mouserpn":"511-stm32u3c5rit6q","event_manufacturer":"stmicroelectronics","event_manufacturerpn":"stm32u3c5rit6q"}); javascript:loadPartDiv("STMicroelectronics", "STM32U3C5RIT6Q", "mouser",1,"zip", 0, "","en-GB")'
      ></button>
    `,
      { url: "https://www.mouser.co.uk/ProductDetail/test" }
    );
    expect(withEcadHooks.findPartContext()).toEqual({
      provider: "mouserSamacsys",
      sourcePartLabel: "Mouser part",
      sourcePartNumber: "511-STM32U3C5RIT6Q",
      manufacturerPartNumber: "STM32U3C5RIT6Q",
      lookup: {
        manufacturerName: "STMicroelectronics",
        entryUrl:
          "https://ms.componentsearchengine.com/entry_u_newDesign.php?mna=STMicroelectronics&mpn=STM32U3C5RIT6Q&pna=mouser&vrq=multi&fmt=zip&lang=en-GB",
        partnerName: "mouser",
        samacsysBaseUrl: "https://ms.componentsearchengine.com"
      }
    });

    const { hooks: withoutEcadHooks } = loadContentScript(
      `
      <div>
        <label for="ManufacturerPartNumber">Mfr. No:</label>
        <input id="ManufacturerPartNumber" value="NO_ECAD_PART" />
      </div>
    `,
      { url: "https://www.mouser.co.uk/ProductDetail/test" }
    );
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
    const { hooks } = loadContentScript(
      `
      <button
        id="lnk_CadModel"
        data-testid="ProductInfoECAD"
        onclick='dataLayer.push({"event_manufacturerpn":"stm32u3c5rit6q"});'
      ></button>
    `,
      { url: "https://www.mouser.co.uk/ProductDetail/test" }
    );

    expect(hooks.findMouserPartContext()).toBeNull();
    expect(hooks.findPartContext()).toEqual({
      provider: null,
      sourcePartLabel: null,
      sourcePartNumber: null,
      manufacturerPartNumber: null,
      lookup: null
    });
  });

  it("detects a Farnell SamacSys part context from a Supplyframe link", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer Part No: FQP27P06</div>
        <div>Order Code: 1848693</div>
        <a href="https://farnell.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=FQP27P06&pna=farnell&logo=farnell&q3=SHOW3D">
          <img alt="Supply Frame Models Link" />
        </a>
      </section>
    `,
      { url: "https://uk.farnell.com/webapp/wcs/stores/servlet/ProductDisplay?partNumber=1848693" }
    );

    expect(
      hooks.parseSamacsysLinkUrl(
        "https://farnell.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=FQP27P06&pna=farnell&logo=farnell&q3=SHOW3D",
        "farnell"
      )
    ).toEqual({
      baseUrl: "https://farnell.componentsearchengine.com",
      manufacturerName: "ONSEMI",
      manufacturerPartNumber: "FQP27P06",
      partnerName: "farnell",
      logo: "farnell",
      lang: "en-GB"
    });
    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "Farnell part",
      sourcePartNumber: "1848693",
      manufacturerPartNumber: "FQP27P06",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=FQP27P06&pna=farnell&vrq=multi&fmt=zip&logo=farnell&lang=en-GB",
        authRefreshUrl:
          "https://farnell.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=FQP27P06&pna=farnell&logo=farnell&q3=SHOW3D",
        partnerName: "farnell",
        samacsysBaseUrl: "https://farnell.componentsearchengine.com"
      }
    });
  });

  it("rejects SamacSys links on lookalike component-search hostnames", () => {
    const { hooks } = loadContentScript("", {
      url: "https://uk.farnell.com/webapp/wcs/stores/servlet/ProductDisplay?partNumber=1848693"
    });

    expect(
      hooks.parseSamacsysLinkUrl(
        "https://evilcomponentsearchengine.com/icon.php?mna=ONSEMI&mpn=FQP27P06&pna=farnell",
        "farnell"
      )
    ).toBeNull();
  });

  it("falls back to Farnell page labels when the Supplyframe link is absent", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer: STMICROELECTRONICS</div>
        <div>Manufacturer Part No: STM32F030C8T6</div>
        <div>Order Code: 2393634</div>
      </section>
      `,
      { url: "https://uk.farnell.com/stmicroelectronics/stm32f030c8t6/mcu-32bit-48mhz-2-4v-3-6v-lqfp/dp/2393634" }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "Farnell part",
      sourcePartNumber: "2393634",
      manufacturerPartNumber: "STM32F030C8T6",
      lookup: {
        manufacturerName: "STMICROELECTRONICS",
        entryUrl:
          "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=STMICROELECTRONICS&mpn=STM32F030C8T6&pna=farnell&vrq=multi&fmt=zip",
        partnerName: "farnell",
        samacsysBaseUrl: "https://farnell.componentsearchengine.com"
      }
    });
  });

  it("detects an element14 SamacSys part context and preserves the element14 host", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer Part No: NB3L553DG</div>
        <div>Order Code: 2101848</div>
        <a href="https://element14.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=NB3L553DG&pna=element14&logo=element14&q3=SHOW3D">
          <img alt="Supply Frame Models Link" />
        </a>
      </section>
      `,
      {
        url: "https://au.element14.com/webapp/wcs/stores/servlet/ProductDisplay?partNumber=2101848"
      }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "element14 part",
      sourcePartNumber: "2101848",
      manufacturerPartNumber: "NB3L553DG",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://element14.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=NB3L553DG&pna=element14&vrq=multi&fmt=zip&logo=element14&lang=en-GB",
        authRefreshUrl:
          "https://element14.componentsearchengine.com/icon.php?lang=en-GB&mna=ONSEMI&mpn=NB3L553DG&pna=element14&logo=element14&q3=SHOW3D",
        partnerName: "element14",
        samacsysBaseUrl: "https://element14.componentsearchengine.com"
      }
    });
  });

  it("falls back to element14 page labels when the Supplyframe link is absent", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer: ONSEMI</div>
        <div>Manufacturer Part No: NB3L553DG</div>
        <div>Order Code: 2101848</div>
      </section>
      `,
      {
        url: "https://au.element14.com/onsemi/nb3l553dg/clock-fanout-buffer-soic-8/dp/2101848"
      }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "element14 part",
      sourcePartNumber: "2101848",
      manufacturerPartNumber: "NB3L553DG",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://element14.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=NB3L553DG&pna=element14&vrq=multi&fmt=zip",
        partnerName: "element14",
        samacsysBaseUrl: "https://element14.componentsearchengine.com"
      }
    });
  });

  it("detects a Newark SamacSys part context and preserves the Newark host", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer Part No: PN2222ATF</div>
        <div>Newark Part No.: 58K2048</div>
        <a href="https://newark.componentsearchengine.com/icon.php?lang=en-US&mna=ONSEMI&mpn=PN2222ATF&pna=newark&logo=newark&q3=SHOW3D">
          <img alt="Supply Frame Models Link" />
        </a>
      </section>
      `,
      {
        url: "https://www.newark.com/webapp/wcs/stores/servlet/ProductDisplay?catalogId=15003&langId=-1&partNumber=58K2048&storeId=10194&urlRequestType=Base"
      }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "Newark part",
      sourcePartNumber: "58K2048",
      manufacturerPartNumber: "PN2222ATF",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://newark.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=PN2222ATF&pna=newark&vrq=multi&fmt=zip&logo=newark&lang=en-US",
        authRefreshUrl:
          "https://newark.componentsearchengine.com/icon.php?lang=en-US&mna=ONSEMI&mpn=PN2222ATF&pna=newark&logo=newark&q3=SHOW3D",
        partnerName: "newark",
        samacsysBaseUrl: "https://newark.componentsearchengine.com"
      }
    });
  });

  it("falls back to Newark page labels when the Supplyframe link is absent", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer: ONSEMI</div>
        <div>Manufacturer Part No: PN2222ATF</div>
        <div>Newark Part No.: 58K2048</div>
      </section>
      `,
      {
        url: "https://www.newark.com/onsemi/pn2222atf/transistor-bjt-npn-to-226aa/dp/58K2048"
      }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "Newark part",
      sourcePartNumber: "58K2048",
      manufacturerPartNumber: "PN2222ATF",
      lookup: {
        manufacturerName: "ONSEMI",
        entryUrl:
          "https://newark.componentsearchengine.com/entry_u_newDesign.php?mna=ONSEMI&mpn=PN2222ATF&pna=newark&vrq=multi&fmt=zip",
        partnerName: "newark",
        samacsysBaseUrl: "https://newark.componentsearchengine.com"
      }
    });
  });

  it("prefers Farnell canonical and meta product data over flattened body text", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>STM32F030C8T6 Order</div>
        <div>2393634 Product</div>
      </section>
      `,
      {
        url: "https://uk.farnell.com/stmicroelectronics/stm32f030c8t6/example/dp/2393634",
        headMarkup: `
          <link rel="canonical" href="https://uk.farnell.com/stmicroelectronics/stm32f030c8t6/mcu-32bit-48mhz-2-4v-3-6v-lqfp/dp/2393634" />
          <meta property="og:image:alt" content="STMICROELECTRONICS STM32F030C8T6" />
          <meta property="og:description" content="Buy STM32F030C8T6 - STMICROELECTRONICS - ARM MCU, Value Line. Farnell UK." />
        `
      }
    );

    expect(hooks.findFarnellPartContext()).toEqual({
      provider: "farnellSamacsys",
      sourcePartLabel: "Farnell part",
      sourcePartNumber: "2393634",
      manufacturerPartNumber: "STM32F030C8T6",
      lookup: {
        manufacturerName: "STMICROELECTRONICS",
        entryUrl:
          "https://farnell.componentsearchengine.com/entry_u_newDesign.php?mna=STMICROELECTRONICS&mpn=STM32F030C8T6&pna=farnell&vrq=multi&fmt=zip",
        partnerName: "farnell",
        samacsysBaseUrl: "https://farnell.componentsearchengine.com"
      }
    });
  });

  it("does not mis-detect a Farnell page as an LCSC part when body text contains C0004-style values", () => {
    const { hooks } = loadContentScript(
      `
      <section>
        <div>Manufacturer Part No: FQP27P06</div>
        <div>Order Code: 1848693</div>
        <div>Internal code: C0004</div>
      </section>
      `,
      { url: "https://uk.farnell.com/webapp/wcs/stores/servlet/ProductDisplay?partNumber=1848693" }
    );

    expect(hooks.findEasyedaPartContext()).toBeNull();
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
