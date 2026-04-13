import { describe, expect, it } from "vitest";

import { createCadData } from "./helpers/fixtures.js";
import {
  applyPinNameStyle,
  applyTextStyle,
  convertEasyedaCadToKicad,
  convertObjToWrlString,
  drillToKi,
  parseSvgPath
} from "../src/kicad_converter.js";

describe("kicad converter", () => {
  it("applies EasyEDA text styling rules to suffix-marked labels", () => {
    expect(applyTextStyle("RESET#")).toBe("~{RESET}");
    expect(applyPinNameStyle("CLK#/RESET#")).toBe("~{CLK}/~{RESET}");
  });

  it("converts representative symbol data into a KiCad symbol library", () => {
    const result = convertEasyedaCadToKicad(createCadData(), {
      symbol: true
    });

    expect(result.symbol.name).toBe("Logic_Buffer");
    expect(result.symbol.content).toContain('(symbol "Logic_Buffer"');
    expect(result.symbol.content).toMatch(/"LCSC Part"\s+"C12345"/);
    expect(result.symbol.content).toContain("(pin input inverted_clock");
    expect(result.symbol.content).toContain('(name "~{CLK}/~{RESET}"');
  });

  it("converts representative footprint data into KiCad footprint text", () => {
    const result = convertEasyedaCadToKicad(createCadData(), {
      footprint: true
    });

    expect(result.footprint.name).toBe("QFN-16/Example");
    expect(result.footprint.content).toContain("(module easyeda2kicad:QFN-16/Example");
    expect(result.footprint.content).toContain("\t(attr smd)");
    expect(result.footprint.content).toContain("(pad 1 smd rect");
    expect(result.footprint.content).toContain("(primitives");
    expect(result.footprint.content).toContain('(model "${KIPRJMOD}/Model QFN.wrl"');
    expect(result.footprint.content).toContain("(rotate (xyz 0 270 180))");
    expect(result.footprint.content).toContain("(layer F.Fab)");
  });

  it("keeps key geometry helpers stable for parsed paths and drill output", () => {
    const parsed = parseSvgPath("M 0 0 A 5 5 0 0 1 10 10 L 20 20 Z");

    expect(parsed.map((step) => step.type)).toEqual(["M", "A", "L", "Z"]);
    expect(drillToKi(0.5, 1.5, 2, 1)).toBe("(drill oval 1.00 1.50)");
    expect(drillToKi(0.5, 0, 2, 1)).toBe("(drill 1.00)");
  });

  it("converts OBJ material groups into WRL output", () => {
    const objData = `
newmtl body
Ka 0.1 0.1 0.1
Kd 0.4 0.5 0.6
Ks 0.7 0.8 0.9
d 1.0
endmtl
v 2.54 0 0
v 0 2.54 0
v 0 0 2.54
usemtl body
f 1 2 3
`.trim();

    const wrl = convertObjToWrlString(objData);

    expect(wrl).toContain("#VRML V2.0 utf8");
    expect(wrl).toContain("diffuseColor 0.4 0.5 0.6");
    expect(wrl).toContain("1.0000 0.0000 0.0000");
    expect(wrl).toContain("Shape{");
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
