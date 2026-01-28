/*
 * This module converts EasyEDA CAD data into KiCad outputs.
 * It parses EasyEDA symbol/footprint strings into structured objects, converts
 * units and coordinate systems, and emits KiCad symbol/footprint text. It also
 * converts OBJ/MTL data into VRML for KiCad's 3D viewer.
 */

// KiCad symbol library metadata written into the output header.
const KI_SYMBOL_LIB_VERSION = "20211014";
const KI_SYMBOL_GENERATOR = "easy EDA downloader";

// Default sizes/offsets used when laying out symbol pins and fields.
const KI_SYMBOL_CONFIG = {
  pinLength: 2.54,
  pinNameSize: 1.27,
  pinNumSize: 1.27,
  propertyFontSize: 1.27,
  fieldOffsetStart: 5.08,
  fieldOffsetIncrement: 2.54,
  defaultLineWidth: 0
};

// String templates for each KiCad footprint element we emit.
const KI_FOOTPRINT_TEMPLATES = {
  moduleInfo: "(module {packageLib}:{packageName} (layer F.Cu) (tedit {edit})\n",
  fpType: "\t(attr {componentType})\n",
  reference:
    "\t(fp_text reference REF** (at {posX} {posY}) (layer F.SilkS)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)\n",
  value:
    "\t(fp_text value {packageName} (at {posX} {posY}) (layer F.Fab)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)\n",
  fabRef:
    "\t(fp_text user %R (at 0 0) (layer F.Fab)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)\n",
  pad:
    "\t(pad {number} {type} {shape} (at {posX} {posY} {orientation}) (size {width} {height}) (layers {layers}){drill}{polygon})\n",
  line:
    "\t(fp_line (start {startX} {startY}) (end {endX} {endY}) (layer {layers}) (width {strokeWidth}))\n",
  hole:
    "\t(pad \"\" thru_hole circle (at {posX} {posY}) (size {size} {size}) (drill {size}) (layers *.Cu *.Mask))\n",
  via:
    "\t(pad \"\" thru_hole circle (at {posX} {posY}) (size {diameter} {diameter}) (drill {size}) (layers *.Cu *.Paste *.Mask))\n",
  circle:
    "\t(fp_circle (center {cx} {cy}) (end {endX} {endY}) (layer {layers}) (width {strokeWidth}))\n",
  arc:
    "\t(fp_arc (start {startX} {startY}) (end {endX} {endY}) (angle {angle}) (layer {layers}) (width {strokeWidth}))\n",
  text:
    "\t(fp_text user {text} (at {posX} {posY} {orientation}) (layer {layers}){display}\n\t\t(effects (font (size {fontSize} {fontSize}) (thickness {thickness})) (justify left{mirror}))\n\t)\n",
  model3d:
    "\t(model \"{file3d}\"\n\t\t(offset (xyz {posX} {posY} {posZ}))\n\t\t(scale (xyz 1 1 1))\n\t\t(rotate (xyz {rotX} {rotY} {rotZ}))\n\t)\n"
};

// Map EasyEDA pad shapes to KiCad pad shapes.
const KI_PAD_SHAPE = {
  ELLIPSE: "circle",
  RECT: "rect",
  OVAL: "oval",
  POLYGON: "custom"
};

// Map EasyEDA layer ids to KiCad layers for SMD pads and graphics.
const KI_PAD_LAYER = {
  1: "F.Cu F.Paste F.Mask",
  2: "B.Cu B.Paste B.Mask",
  3: "F.SilkS",
  11: "*.Cu *.Paste *.Mask",
  13: "F.Fab",
  15: "Dwgs.User"
};

// Map EasyEDA layer ids to KiCad layers for through-hole pads.
const KI_PAD_LAYER_THT = {
  1: "F.Cu F.Mask",
  2: "B.Cu B.Mask",
  3: "F.SilkS",
  11: "*.Cu *.Mask",
  13: "F.Fab",
  15: "Dwgs.User"
};

// General layer lookup used by graphics and text.
const KI_LAYERS = {
  1: "F.Cu",
  2: "B.Cu",
  3: "F.SilkS",
  4: "B.SilkS",
  5: "F.Paste",
  6: "B.Paste",
  7: "F.Mask",
  8: "B.Mask",
  10: "Edge.Cuts",
  11: "Edge.Cuts",
  12: "Cmts.User",
  13: "F.Fab",
  14: "B.Fab",
  15: "Dwgs.User",
  101: "F.Fab"
};

// Convert EasyEDA numeric pin types to KiCad pin type strings.
const EASYEDA_PIN_TYPE_MAP = {
  0: "unspecified",
  1: "input",
  2: "output",
  3: "bidirectional",
  4: "power_in"
};

// Safely parse numbers and fall back when data is missing or invalid.
function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Normalize EasyEDA "show/hide" style flags into real booleans.
function toBool(value) {
  if (value === true || value === false) {
    return value;
  }
  const str = String(value || "").toLowerCase();
  if (str === "show" || str === "true" || str === "1") {
    return true;
  }
  if (str === "hide" || str === "false" || str === "0" || str === "") {
    return false;
  }
  return Boolean(value);
}

// Clean text used as symbol ids or filenames.
function sanitizeFields(name) {
  return String(name || "").replace(/\s+/g, "").replace(/\//g, "_");
}

// Apply EasyEDA's suffix conventions to KiCad text formatting.
function applyTextStyle(text) {
  if (text.endsWith("#")) {
    return `~{${text.slice(0, -1)}}`;
  }
  return text;
}

// Apply text styling to each pin name segment separated by "/".
function applyPinNameStyle(pinName) {
  return String(pinName || "")
    .split("/")
    .map((value) => applyTextStyle(value))
    .join("/");
}

// Convert EasyEDA pixels into millimeters (symbol scale).
function pxToMm(dim) {
  return 10.0 * Number(dim) * 0.0254;
}

// Convert EasyEDA length units into millimeters (footprint scale).
function convertToMm(dim) {
  return Number(dim) * 10 * 0.0254;
}

// Parse a small subset of SVG path commands (M, A, L, Z) into objects.
function parseSvgPath(svgPath) {
  let path = String(svgPath || "");
  if (!path.endsWith(" ")) {
    path += " ";
  }
  path = path.replace(/,/g, " ");
  const matches = [...path.matchAll(/([a-zA-Z])([ ,\-+.\d]+)/g)];
  const parsed = [];

  for (const match of matches) {
    const cmd = match[1];
    const args = match[2].trim().split(/\s+/);
    if (cmd === "M") {
      for (let i = 0; i < args.length; i += 2) {
        parsed.push({
          type: "M",
          startX: toNumber(args[i]),
          startY: toNumber(args[i + 1])
        });
      }
    } else if (cmd === "A") {
      for (let i = 0; i < args.length; i += 7) {
        parsed.push({
          type: "A",
          radiusX: toNumber(args[i]),
          radiusY: toNumber(args[i + 1]),
          xAxisRotation: toNumber(args[i + 2]),
          flagLargeArc: args[i + 3] === "1",
          flagSweep: args[i + 4] === "1",
          endX: toNumber(args[i + 5]),
          endY: toNumber(args[i + 6])
        });
      }
    } else if (cmd === "L") {
      for (let i = 0; i < args.length; i += 2) {
        parsed.push({
          type: "L",
          posX: toNumber(args[i]),
          posY: toNumber(args[i + 1])
        });
      }
    } else if (cmd === "Z") {
      parsed.push({ type: "Z" });
    }
  }

  return parsed;
}

// Angle helpers used by arc math.
function toRadians(angle) {
  return (angle / 180) * Math.PI;
}

function toDegrees(angle) {
  return (angle / Math.PI) * 180;
}

// Convert SVG arc parameters into a center point and sweep angle.
function computeArc(
  startX,
  startY,
  radiusX,
  radiusY,
  angle,
  largeArcFlag,
  sweepFlag,
  endX,
  endY
) {
  const dx2 = (startX - endX) / 2.0;
  const dy2 = (startY - endY) / 2.0;

  const phi = toRadians(angle % 360.0);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const x1 = cosPhi * dx2 + sinPhi * dy2;
  const y1 = -sinPhi * dx2 + cosPhi * dy2;

  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  let prx = rx * rx;
  let pry = ry * ry;
  const px1 = x1 * x1;
  const py1 = y1 * y1;

  const radiiCheck = prx && pry ? px1 / prx + py1 / pry : 0;
  if (radiiCheck > 1) {
    rx = Math.sqrt(radiiCheck) * rx;
    ry = Math.sqrt(radiiCheck) * ry;
    prx = rx * rx;
    pry = ry * ry;
  }

  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  let sq = 0;
  if (prx * py1 + pry * px1 > 0) {
    sq = (prx * pry - prx * py1 - pry * px1) / (prx * py1 + pry * px1);
  }
  sq = Math.max(sq, 0);
  const coef = sign * Math.sqrt(sq);
  const cx1 = coef * ((rx * y1) / ry);
  const cy1 = rx !== 0 ? coef * -((ry * x1) / rx) : 0;

  const sx2 = (startX + endX) / 2.0;
  const sy2 = (startY + endY) / 2.0;
  const cx = sx2 + (cosPhi * cx1 - sinPhi * cy1);
  const cy = sy2 + (sinPhi * cx1 + cosPhi * cy1);

  const ux = rx !== 0 ? (x1 - cx1) / rx : 0;
  const uy = ry !== 0 ? (y1 - cy1) / ry : 0;
  const vx = rx !== 0 ? (-x1 - cx1) / rx : 0;
  const vy = ry !== 0 ? (-y1 - cy1) / ry : 0;

  const n = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const p = ux * vx + uy * vy;
  const signAngle = ux * vy - uy * vx < 0 ? -1 : 1;
  let angleExtent = n !== 0 ? toDegrees(signAngle * Math.acos(p / n)) : 719;
  if (!sweepFlag && angleExtent > 0) {
    angleExtent -= 360;
  } else if (sweepFlag && angleExtent < 0) {
    angleExtent += 360;
  }

  const extentSign = angleExtent < 0 ? 1 : -1;
  angleExtent = (Math.abs(angleExtent) % 360) * extentSign;

  return { cx, cy, angleExtent };
}

// Compute the midpoint on an arc for KiCad's start/mid/end format.
function getMiddleArcPos(centerX, centerY, radius, angleStart, angleEnd) {
  const middleX =
    centerX + radius * Math.cos(((angleStart + angleEnd) / 2) * (Math.PI / 180));
  const middleY =
    centerY + radius * Math.sin(((angleStart + angleEnd) / 2) * (Math.PI / 180));
  return { middleX, middleY };
}

// Read EasyEDA symbol data and turn it into a normalized JS object.
function parseEasyedaSymbol(cadData) {
  const info = cadData?.dataStr?.head?.c_para || {};
  const lcsc = cadData?.lcsc || {};
  const bbox = {
    x: toNumber(cadData?.dataStr?.head?.x),
    y: toNumber(cadData?.dataStr?.head?.y)
  };

  const symbol = {
    info: {
      name: info.name || "",
      prefix: String(info.pre || "").replace("?", ""),
      package: info.package || "",
      manufacturer: info.BOM_Manufacturer || "",
      datasheet: lcsc.url || "",
      lcscId: lcsc.number || "",
      jlcId: info["BOM_JLCPCB Part Class"] || ""
    },
    bbox,
    pins: [],
    rectangles: [],
    circles: [],
    arcs: [],
    ellipses: [],
    polylines: [],
    polygons: [],
    paths: []
  };

  // Parse each serialized shape line into the right bucket.
  const shapes = cadData?.dataStr?.shape || [];
  for (const line of shapes) {
    const designator = line.split("~")[0];
    if (designator === "P") {
      const segments = line.split("^^");
      const settingsFields = segments[0].split("~").slice(1);
      const pinPathFields = (segments[2] || "").split("~");
      const pinNameFields = (segments[3] || "").split("~");
      const pinDotBisFields = (segments[5] || "").split("~");
      const pinClockFields = (segments[6] || "").split("~");

      const pin = {
        settings: {
          isDisplayed: toBool(settingsFields[0]),
          type: toNumber(settingsFields[1]),
          number: String(settingsFields[2] || "").trim(),
          posX: toNumber(settingsFields[3]),
          posY: toNumber(settingsFields[4]),
          rotation: toNumber(settingsFields[5]),
          id: settingsFields[6] || "",
          isLocked: toBool(settingsFields[7])
        },
        pinPath: {
          path: String(pinPathFields[0] || "").replace(/v/g, "h"),
          color: pinPathFields[1] || ""
        },
        name: {
          isDisplayed: toBool(pinNameFields[0]),
          posX: toNumber(pinNameFields[1]),
          posY: toNumber(pinNameFields[2]),
          rotation: toNumber(pinNameFields[3]),
          text: pinNameFields[4] || "",
          textAnchor: pinNameFields[5] || "",
          font: pinNameFields[6] || "",
          fontSize: String(pinNameFields[7] || "").includes("pt")
            ? toNumber(String(pinNameFields[7]).replace("pt", ""), 7)
            : toNumber(pinNameFields[7], 7)
        },
        dot: {
          isDisplayed: toBool(pinDotBisFields[0]),
          circleX: toNumber(pinDotBisFields[1]),
          circleY: toNumber(pinDotBisFields[2])
        },
        clock: {
          isDisplayed: toBool(pinClockFields[0]),
          path: pinClockFields[1] || ""
        }
      };
      symbol.pins.push(pin);
    } else if (designator === "R") {
      const fields = line.split("~").slice(1);
      symbol.rectangles.push({
        posX: toNumber(fields[0]),
        posY: toNumber(fields[1]),
        width: toNumber(fields[4]),
        height: toNumber(fields[5])
      });
    } else if (designator === "PL") {
      const fields = line.split("~").slice(1);
      symbol.polylines.push({
        points: fields[0],
        fillColor: String(fields[4] || "").toLowerCase() !== "none"
      });
    } else if (designator === "PG") {
      const fields = line.split("~").slice(1);
      symbol.polygons.push({
        points: fields[0],
        fillColor: true
      });
    } else if (designator === "PT") {
      const fields = line.split("~").slice(1);
      symbol.paths.push({
        paths: fields[0]
      });
    } else if (designator === "C") {
      const fields = line.split("~").slice(1);
      symbol.circles.push({
        centerX: toNumber(fields[0]),
        centerY: toNumber(fields[1]),
        radius: toNumber(fields[2]),
        fillColor: String(fields[5] || "").toLowerCase() !== "none"
      });
    } else if (designator === "E") {
      const fields = line.split("~").slice(1);
      symbol.ellipses.push({
        centerX: toNumber(fields[0]),
        centerY: toNumber(fields[1]),
        radiusX: toNumber(fields[2]),
        radiusY: toNumber(fields[3])
      });
    } else if (designator === "A") {
      const fields = line.split("~").slice(1);
      symbol.arcs.push({
        path: parseSvgPath(fields[0]),
        fillColor: String(fields[4] || "").toLowerCase() !== "none"
      });
    }
  }

  return symbol;
}

// Read EasyEDA footprint data and turn it into a normalized JS object.
function parseEasyedaFootprint(cadData) {
  const dataStr = cadData?.packageDetail?.dataStr;
  const info = dataStr?.head?.c_para || {};
  const isSmd =
    Boolean(cadData?.SMT) &&
    !String(cadData?.packageDetail?.title || "").includes("-TH_");

  const footprint = {
    info: {
      name: info.package || "",
      fpType: isSmd ? "smd" : "tht",
      model3dName: info["3DModel"] || ""
    },
    bbox: {
      x: toNumber(dataStr?.head?.x),
      y: toNumber(dataStr?.head?.y)
    },
    model3d: null,
    pads: [],
    tracks: [],
    holes: [],
    vias: [],
    circles: [],
    arcs: [],
    rectangles: [],
    texts: []
  };

  // Parse each serialized shape line into the right bucket.
  const shapes = dataStr?.shape || [];
  for (const line of shapes) {
    const parts = line.split("~");
    const designator = parts[0];
    const fields = parts.slice(1);

    if (designator === "PAD") {
      footprint.pads.push({
        shape: fields[0],
        centerX: toNumber(fields[1]),
        centerY: toNumber(fields[2]),
        width: toNumber(fields[3]),
        height: toNumber(fields[4]),
        layerId: toNumber(fields[5]),
        net: fields[6] || "",
        number: fields[7] || "",
        holeRadius: toNumber(fields[8]),
        points: fields[9] || "",
        rotation: toNumber(fields[10]),
        id: fields[11] || "",
        holeLength: toNumber(fields[12]),
        holePoint: fields[13] || "",
        isPlated: toBool(fields[14]),
        isLocked: toBool(fields[15])
      });
    } else if (designator === "TRACK") {
      footprint.tracks.push({
        strokeWidth: toNumber(fields[0]),
        layerId: toNumber(fields[1]),
        net: fields[2] || "",
        points: fields[3] || "",
        id: fields[4] || "",
        isLocked: toBool(fields[5])
      });
    } else if (designator === "HOLE") {
      footprint.holes.push({
        centerX: toNumber(fields[0]),
        centerY: toNumber(fields[1]),
        radius: toNumber(fields[2]),
        id: fields[3] || "",
        isLocked: toBool(fields[4])
      });
    } else if (designator === "VIA") {
      footprint.vias.push({
        centerX: toNumber(fields[0]),
        centerY: toNumber(fields[1]),
        diameter: toNumber(fields[2]),
        net: fields[3] || "",
        radius: toNumber(fields[4]),
        id: fields[5] || "",
        isLocked: toBool(fields[6])
      });
    } else if (designator === "CIRCLE") {
      footprint.circles.push({
        cx: toNumber(fields[0]),
        cy: toNumber(fields[1]),
        radius: toNumber(fields[2]),
        strokeWidth: toNumber(fields[3]),
        layerId: toNumber(fields[4]),
        id: fields[5] || "",
        isLocked: toBool(fields[6])
      });
    } else if (designator === "ARC") {
      footprint.arcs.push({
        strokeWidth: toNumber(fields[0]),
        layerId: toNumber(fields[1]),
        net: fields[2] || "",
        path: fields[3] || "",
        helperDots: fields[4] || "",
        id: fields[5] || "",
        isLocked: toBool(fields[6])
      });
    } else if (designator === "RECT") {
      footprint.rectangles.push({
        x: toNumber(fields[0]),
        y: toNumber(fields[1]),
        width: toNumber(fields[2]),
        height: toNumber(fields[3]),
        strokeWidth: toNumber(fields[4]),
        id: fields[5] || "",
        layerId: toNumber(fields[6]),
        isLocked: toBool(fields[7])
      });
    } else if (designator === "TEXT") {
      footprint.texts.push({
        type: fields[0] || "",
        centerX: toNumber(fields[1]),
        centerY: toNumber(fields[2]),
        strokeWidth: toNumber(fields[3]),
        rotation: toNumber(fields[4]),
        mirror: fields[5] || "",
        layerId: toNumber(fields[6]),
        net: fields[7] || "",
        fontSize: toNumber(fields[8]),
        text: fields[9] || "",
        textPath: fields[10] || "",
        isDisplayed: toBool(fields[11]),
        id: fields[12] || "",
        isLocked: toBool(fields[13])
      });
    } else if (designator === "SVGNODE") {
      try {
        const rawJson = fields[0];
        const attrs = JSON.parse(rawJson).attrs;
        footprint.model3d = {
          name: attrs.title || "",
          uuid: attrs.uuid || "",
          translation: {
            x: toNumber(String(attrs.c_origin || "0,0").split(",")[0]),
            y: toNumber(String(attrs.c_origin || "0,0").split(",")[1]),
            z: toNumber(attrs.z)
          },
          rotation: {
            x: toNumber(String(attrs.c_rotation || "0,0,0").split(",")[0]),
            y: toNumber(String(attrs.c_rotation || "0,0,0").split(",")[1]),
            z: toNumber(String(attrs.c_rotation || "0,0,0").split(",")[2])
          }
        };
      } catch (error) {
        // ignore malformed 3D metadata
      }
    }
  }

  return footprint;
}

// Convert the parsed symbol into KiCad-friendly geometry and pin data.
function convertSymbolToKiCad(symbol) {
  // Convert pins and map styles/types to KiCad equivalents.
  const pins = symbol.pins.map((pin) => {
    const pinLengthRaw = String(pin.pinPath.path || "").split("h").pop();
    const pinLength = Math.abs(toNumber(pinLengthRaw));

    const style = pin.dot.isDisplayed && pin.clock.isDisplayed
      ? "inverted_clock"
      : pin.dot.isDisplayed
        ? "inverted"
        : pin.clock.isDisplayed
          ? "clock"
          : "line";

    const type = EASYEDA_PIN_TYPE_MAP[pin.settings.type] || "unspecified";

    return {
      name: pin.name.text.replace(/\s+/g, ""),
      number: String(pin.settings.number || "").replace(/\s+/g, ""),
      style,
      length: pxToMm(pinLength),
      type,
      orientation: (180 + pin.settings.rotation) % 360,
      posX: pxToMm(toNumber(pin.settings.posX) - toNumber(symbol.bbox.x)),
      posY: -pxToMm(toNumber(pin.settings.posY) - toNumber(symbol.bbox.y))
    };
  });

  // Convert rectangles from EasyEDA's top-left system into KiCad coords.
  const rectangles = symbol.rectangles.map((rect) => {
    const posX0 = pxToMm(rect.posX - symbol.bbox.x);
    const posY0 = -pxToMm(rect.posY - symbol.bbox.y);
    return {
      posX0,
      posY0,
      posX1: posX0 + pxToMm(rect.width),
      posY1: posY0 - pxToMm(rect.height)
    };
  });

  // Convert circles, keeping fill state for KiCad background fills.
  const circles = symbol.circles.map((circle) => ({
    posX: pxToMm(circle.centerX - symbol.bbox.x),
    posY: -pxToMm(circle.centerY - symbol.bbox.y),
    radius: pxToMm(circle.radius),
    background: circle.fillColor
  }));

  // Convert ellipses only when they are circles (KiCad doesn't support ellipses).
  const ellipses = symbol.ellipses
    .filter((ellipse) => ellipse.radiusX === ellipse.radiusY)
    .map((ellipse) => ({
      posX: pxToMm(ellipse.centerX - symbol.bbox.x),
      posY: -pxToMm(ellipse.centerY - symbol.bbox.y),
      radius: pxToMm(ellipse.radiusX),
      background: false
    }));

  // Convert SVG arcs into KiCad arcs using start/mid/end points.
  const arcs = [];
  for (const arc of symbol.arcs) {
    if (arc.path.length < 2 || arc.path[0].type !== "M" || arc.path[1].type !== "A") {
      continue;
    }
    const move = arc.path[0];
    const ellipseArc = arc.path[1];

    const startX = pxToMm(move.startX - symbol.bbox.x);
    const startY = -pxToMm(move.startY - symbol.bbox.y);
    const endX = pxToMm(ellipseArc.endX - symbol.bbox.x);
    const endY = -pxToMm(ellipseArc.endY - symbol.bbox.y);
    const radius = pxToMm(
      Math.max(ellipseArc.radiusX, ellipseArc.radiusY)
    );

    const arcInfo = computeArc(
      startX,
      startY,
      pxToMm(ellipseArc.radiusX),
      pxToMm(ellipseArc.radiusY),
      ellipseArc.xAxisRotation,
      ellipseArc.flagLargeArc,
      !ellipseArc.flagSweep,
      endX,
      endY
    );

    const startAngle = toDegrees(Math.atan2(startY - arcInfo.cy, startX - arcInfo.cx));
    const endAngle = startAngle + arcInfo.angleExtent;
    const middle = getMiddleArcPos(
      arcInfo.cx,
      arcInfo.cy,
      radius,
      startAngle,
      endAngle
    );

    arcs.push({
      startX,
      startY,
      middleX: middle.middleX,
      middleY: middle.middleY,
      endX,
      endY,
      fill: arc.fillColor
    });
  }

  // Convert EasyEDA polylines/polygons into point arrays.
  function convertPolyline(polyline, closeIfFilled) {
    const rawPts = String(polyline.points || "").trim().split(/\s+/);
    const xPoints = [];
    const yPoints = [];
    for (let i = 0; i < rawPts.length; i += 2) {
      xPoints.push(pxToMm(toNumber(rawPts[i]) - symbol.bbox.x));
      yPoints.push(-pxToMm(toNumber(rawPts[i + 1]) - symbol.bbox.y));
    }
    if (closeIfFilled) {
      xPoints.push(xPoints[0]);
      yPoints.push(yPoints[0]);
    }
    if (!xPoints.length || !yPoints.length) {
      return null;
    }
    return {
      points: xPoints.map((x, idx) => [x, yPoints[idx]]),
      isClosed: xPoints[0] === xPoints[xPoints.length - 1]
    };
  }

  // Merge polylines and polygons into KiCad polylines.
  const polygons = [];
  for (const polyline of symbol.polylines) {
    const poly = convertPolyline(polyline, polyline.fillColor);
    if (poly) {
      polygons.push(poly);
    }
  }
  for (const polygon of symbol.polygons) {
    const poly = convertPolyline(polygon, true);
    if (poly) {
      polygons.push(poly);
    }
  }

  // Convert path strings into polylines when they only use M/L/Z.
  for (const path of symbol.paths) {
    const rawPts = String(path.paths || "").trim().split(/\s+/);
    const xPoints = [];
    const yPoints = [];
    for (let i = 0; i < rawPts.length; i++) {
      const token = rawPts[i];
      if (token === "M" || token === "L") {
        xPoints.push(pxToMm(toNumber(rawPts[i + 1]) - symbol.bbox.x));
        yPoints.push(-pxToMm(toNumber(rawPts[i + 2]) - symbol.bbox.y));
        i += 2;
      } else if (token === "Z") {
        xPoints.push(xPoints[0]);
        yPoints.push(yPoints[0]);
      }
    }
    if (xPoints.length && yPoints.length) {
      polygons.push({
        points: xPoints.map((x, idx) => [x, yPoints[idx]]),
        isClosed: xPoints[0] === xPoints[xPoints.length - 1]
      });
    }
  }

  return {
    info: symbol.info,
    pins,
    rectangles,
    circles: circles.concat(ellipses),
    arcs,
    polygons
  };
}

// Convert a symbol object into a full KiCad symbol library file text.
function exportKiCadSymbolLibrary(kiSymbol) {
  const pins = kiSymbol.pins || [];
  const yLow = pins.length ? Math.min(...pins.map((pin) => pin.posY)) : 0;
  const yHigh = pins.length ? Math.max(...pins.map((pin) => pin.posY)) : 0;

  // Lay out property fields above/below the symbol.
  const properties = [];
  let offsetY = KI_SYMBOL_CONFIG.fieldOffsetStart;

  properties.push(
    formatSymbolProperty("Reference", kiSymbol.info.prefix || "U", 0, yHigh + offsetY, 0)
  );
  properties.push(
    formatSymbolProperty("Value", kiSymbol.info.name || "", 1, yLow - offsetY, 0)
  );

  if (kiSymbol.info.package) {
    offsetY += KI_SYMBOL_CONFIG.fieldOffsetIncrement;
    properties.push(
      formatSymbolProperty("Footprint", kiSymbol.info.package, 2, yLow - offsetY, 0, true)
    );
  }
  if (kiSymbol.info.datasheet) {
    offsetY += KI_SYMBOL_CONFIG.fieldOffsetIncrement;
    properties.push(
      formatSymbolProperty("Datasheet", kiSymbol.info.datasheet, 3, yLow - offsetY, 0, true)
    );
  }
  if (kiSymbol.info.manufacturer) {
    offsetY += KI_SYMBOL_CONFIG.fieldOffsetIncrement;
    properties.push(
      formatSymbolProperty("Manufacturer", kiSymbol.info.manufacturer, 4, yLow - offsetY, 0, true)
    );
  }
  if (kiSymbol.info.lcscId) {
    offsetY += KI_SYMBOL_CONFIG.fieldOffsetIncrement;
    properties.push(
      formatSymbolProperty("LCSC Part", kiSymbol.info.lcscId, 5, yLow - offsetY, 0, true)
    );
  }
  if (kiSymbol.info.jlcId) {
    offsetY += KI_SYMBOL_CONFIG.fieldOffsetIncrement;
    properties.push(
      formatSymbolProperty("JLC Part", kiSymbol.info.jlcId, 6, yLow - offsetY, 0, true)
    );
  }

  // Gather graphics and pins into KiCad symbol blocks.
  const symbolId = sanitizeFields(kiSymbol.info.name || "symbol");
  const graphicItems = [
    ...kiSymbol.rectangles.map(exportSymbolRectangle),
    ...kiSymbol.circles.map(exportSymbolCircle),
    ...kiSymbol.arcs.map(exportSymbolArc),
    ...kiSymbol.polygons.map(exportSymbolPolygon)
  ].join("\n");

  const pinItems = kiSymbol.pins.map(exportSymbolPin).join("\n");

  // Wrap everything in KiCad's symbol library container.
  const symbolBlock = `
(symbol "${symbolId}"
  (in_bom yes)
  (on_board yes)
${properties.map((line) => `  ${line.trim()}`).join("\n")}
  (symbol "${symbolId}_0_1"
${indentLines(graphicItems, 4)}
${indentLines(pinItems, 4)}
  )
)`.trim();

  return `(kicad_symbol_lib
  (version ${KI_SYMBOL_LIB_VERSION})
  (generator "${KI_SYMBOL_GENERATOR}")
${indentLines(symbolBlock, 1)}
)\n`;
}

// Build a KiCad property entry for symbol metadata.
function formatSymbolProperty(key, value, id, posY, rotation, hide = false) {
  const hideFlag = hide ? "hide" : "";
  return `(property
  "${key}"
  "${value}"
  (id ${id})
  (at 0 ${posY.toFixed(2)} ${rotation})
  (effects (font (size ${KI_SYMBOL_CONFIG.propertyFontSize} ${KI_SYMBOL_CONFIG.propertyFontSize}) ) ${hideFlag})
)`;
}

// Emit a single KiCad pin from normalized pin data.
function exportSymbolPin(pin) {
  const pinName = applyPinNameStyle(pin.name);
  const pinType = pin.type.startsWith("_") ? pin.type.slice(1) : pin.type;
  return `(pin ${pinType} ${pin.style}
  (at ${pin.posX.toFixed(2)} ${pin.posY.toFixed(2)} ${pin.orientation})
  (length ${pin.length.toFixed(2)})
  (name "${pinName}" (effects (font (size ${KI_SYMBOL_CONFIG.pinNameSize} ${KI_SYMBOL_CONFIG.pinNameSize}))))
  (number "${pin.number}" (effects (font (size ${KI_SYMBOL_CONFIG.pinNumSize} ${KI_SYMBOL_CONFIG.pinNumSize}))))
)`;
}

// Emit a KiCad rectangle from start/end corners.
function exportSymbolRectangle(rect) {
  return `(rectangle
  (start ${rect.posX0.toFixed(2)} ${rect.posY0.toFixed(2)})
  (end ${rect.posX1.toFixed(2)} ${rect.posY1.toFixed(2)})
  (stroke (width ${KI_SYMBOL_CONFIG.defaultLineWidth}) (type default) (color 0 0 0 0))
  (fill (type background))
)`;
}

// Emit a KiCad circle from center and radius.
function exportSymbolCircle(circle) {
  return `(circle
  (center ${circle.posX.toFixed(2)} ${circle.posY.toFixed(2)})
  (radius ${circle.radius.toFixed(2)})
  (stroke (width ${KI_SYMBOL_CONFIG.defaultLineWidth}) (type default) (color 0 0 0 0))
  (fill (type ${circle.background ? "background" : "none"}))
)`;
}

// Emit a KiCad arc using start/mid/end points.
function exportSymbolArc(arc) {
  return `(arc
  (start ${arc.startX.toFixed(2)} ${arc.startY.toFixed(2)})
  (mid ${arc.middleX.toFixed(2)} ${arc.middleY.toFixed(2)})
  (end ${arc.endX.toFixed(2)} ${arc.endY.toFixed(2)})
  (stroke (width ${KI_SYMBOL_CONFIG.defaultLineWidth}) (type default) (color 0 0 0 0))
  (fill (type ${arc.fill ? "background" : "none"}))
)`;
}

// Emit a KiCad polyline, optionally filled if closed.
function exportSymbolPolygon(poly) {
  return `(polyline
  (pts
${poly.points
  .map((point) => `    (xy ${point[0].toFixed(2)} ${point[1].toFixed(2)})`)
  .join("\n")}
  )
  (stroke (width ${KI_SYMBOL_CONFIG.defaultLineWidth}) (type default) (color 0 0 0 0))
  (fill (type ${poly.isClosed ? "background" : "none"}))
)`;
}

// Indent multi-line output to match KiCad formatting.
function indentLines(text, indentLevel) {
  if (!text.trim()) {
    return "";
  }
  const indent = "  ".repeat(indentLevel);
  return text
    .split("\n")
    .map((line) => (line.trim() ? `${indent}${line}` : line))
    .join("\n");
}

// Convert rotation angles into KiCad's signed degree convention.
function angleToKi(rotation) {
  const value = toNumber(rotation);
  if (!Number.isFinite(value)) {
    return "";
  }
  return value > 180 ? -(360 - value) : value;
}

// Rotate a point around the origin by degrees.
function rotate(x, y, degrees) {
  const radians = (degrees / 180) * 2 * Math.PI;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians)
  };
}

// Build KiCad drill syntax for round or oval holes.
function drillToKi(holeRadius, holeLength, padHeight, padWidth) {
  if (holeRadius > 0 && holeLength && holeLength !== 0) {
    const maxDistanceHole = Math.max(holeRadius * 2, holeLength);
    const pos0 = padHeight - maxDistanceHole;
    const pos90 = padWidth - maxDistanceHole;
    const maxDistance = Math.max(pos0, pos90);
    if (maxDistance === pos0) {
      return `(drill oval ${(holeRadius * 2).toFixed(2)} ${holeLength.toFixed(2)})`;
    }
    return `(drill oval ${holeLength.toFixed(2)} ${(holeRadius * 2).toFixed(2)})`;
  }
  if (holeRadius > 0) {
    return `(drill ${(2 * holeRadius).toFixed(2)})`;
  }
  return "";
}

// Convert footprint units and coordinate systems into KiCad-friendly values.
function convertFootprintToKiCad(footprint) {
  const bbox = {
    x: convertToMm(footprint.bbox.x),
    y: convertToMm(footprint.bbox.y)
  };

  // Convert pad geometry into millimeters.
  const pads = footprint.pads.map((pad) => ({
    ...pad,
    centerX: convertToMm(pad.centerX),
    centerY: convertToMm(pad.centerY),
    width: convertToMm(pad.width),
    height: convertToMm(pad.height),
    holeRadius: convertToMm(pad.holeRadius),
    holeLength: convertToMm(pad.holeLength)
  }));

  // Convert track widths into millimeters.
  const tracks = footprint.tracks.map((track) => ({
    ...track,
    strokeWidth: convertToMm(track.strokeWidth)
  }));

  // Convert hole locations and sizes.
  const holes = footprint.holes.map((hole) => ({
    ...hole,
    centerX: convertToMm(hole.centerX),
    centerY: convertToMm(hole.centerY),
    radius: convertToMm(hole.radius)
  }));

  // Convert via sizes.
  const vias = footprint.vias.map((via) => ({
    ...via,
    centerX: convertToMm(via.centerX),
    centerY: convertToMm(via.centerY),
    diameter: convertToMm(via.diameter),
    radius: convertToMm(via.radius)
  }));

  // Convert circle geometry.
  const circles = footprint.circles.map((circle) => ({
    ...circle,
    cx: convertToMm(circle.cx),
    cy: convertToMm(circle.cy),
    radius: convertToMm(circle.radius),
    strokeWidth: convertToMm(circle.strokeWidth)
  }));

  // Convert rectangle geometry.
  const rectangles = footprint.rectangles.map((rect) => ({
    ...rect,
    x: convertToMm(rect.x),
    y: convertToMm(rect.y),
    width: convertToMm(rect.width),
    height: convertToMm(rect.height)
  }));

  // Convert text sizes and positions.
  const texts = footprint.texts.map((text) => ({
    ...text,
    centerX: convertToMm(text.centerX),
    centerY: convertToMm(text.centerY),
    strokeWidth: convertToMm(text.strokeWidth),
    fontSize: convertToMm(text.fontSize)
  }));

  // Rebase and flip 3D model transforms to KiCad's coordinate system.
  const model3d = footprint.model3d
    ? {
        ...footprint.model3d,
        translation: {
          x: convertToMm(footprint.model3d.translation.x) - bbox.x,
          y: -(convertToMm(footprint.model3d.translation.y) - bbox.y),
          z: footprint.info.fpType === "smd"
            ? -convertToMm(footprint.model3d.translation.z)
            : 0
        },
        rotation: {
          x: (360 - convertToMm(footprint.model3d.rotation.x)) % 360,
          y: (360 - convertToMm(footprint.model3d.rotation.y)) % 360,
          z: (360 - convertToMm(footprint.model3d.rotation.z)) % 360
        }
      }
    : null;

  return {
    info: footprint.info,
    bbox,
    pads,
    tracks,
    holes,
    vias,
    circles,
    arcs: footprint.arcs,
    rectangles,
    texts,
    model3d
  };
}

// Emit a KiCad footprint file from the converted footprint object.
function exportKiCadFootprint(kiFootprint, model3dPath) {
  let output = "";
  output += KI_FOOTPRINT_TEMPLATES.moduleInfo
    .replace("{packageLib}", "easyeda2kicad")
    .replace("{packageName}", kiFootprint.info.name)
    .replace("{edit}", "5DC5F6A4");

  if (kiFootprint.info.fpType) {
    output += KI_FOOTPRINT_TEMPLATES.fpType.replace(
      "{componentType}",
      kiFootprint.info.fpType === "smd" ? "smd" : "through_hole"
    );
  }

  // Reference/value text placement uses min/max pad Y to sit outside the part.
  const yLow = kiFootprint.pads.length
    ? Math.min(...kiFootprint.pads.map((pad) => pad.centerY - kiFootprint.bbox.y))
    : -2;
  const yHigh = kiFootprint.pads.length
    ? Math.max(...kiFootprint.pads.map((pad) => pad.centerY - kiFootprint.bbox.y))
    : 2;

  output += KI_FOOTPRINT_TEMPLATES.reference
    .replace("{posX}", "0")
    .replace("{posY}", (yLow - 4).toFixed(2));
  output += KI_FOOTPRINT_TEMPLATES.value
    .replace("{packageName}", kiFootprint.info.name)
    .replace("{posX}", "0")
    .replace("{posY}", (yHigh + 4).toFixed(2));
  output += KI_FOOTPRINT_TEMPLATES.fabRef;

  // Convert each EasyEDA track into KiCad fp_line segments.
  for (const track of kiFootprint.tracks) {
    const points = String(track.points || "").trim().split(/\s+/).map(fpToKi);
    for (let i = 0; i < points.length - 2; i += 2) {
      output += KI_FOOTPRINT_TEMPLATES.line
        .replace("{startX}", (points[i] - kiFootprint.bbox.x).toFixed(2))
        .replace("{startY}", (points[i + 1] - kiFootprint.bbox.y).toFixed(2))
        .replace("{endX}", (points[i + 2] - kiFootprint.bbox.x).toFixed(2))
        .replace("{endY}", (points[i + 3] - kiFootprint.bbox.y).toFixed(2))
        .replace("{layers}", KI_PAD_LAYER[track.layerId] || "F.Fab")
        .replace("{strokeWidth}", Math.max(track.strokeWidth, 0.01).toFixed(2));
    }
  }

  // Convert rectangles into four KiCad fp_line segments.
  for (const rect of kiFootprint.rectangles) {
    const startX = rect.x - kiFootprint.bbox.x;
    const startY = rect.y - kiFootprint.bbox.y;
    const width = rect.width;
    const height = rect.height;
    const points = [
      [startX, startY, startX + width, startY],
      [startX + width, startY, startX + width, startY + height],
      [startX + width, startY + height, startX, startY + height],
      [startX, startY + height, startX, startY]
    ];
    for (const [sx, sy, ex, ey] of points) {
      output += KI_FOOTPRINT_TEMPLATES.line
        .replace("{startX}", sx.toFixed(2))
        .replace("{startY}", sy.toFixed(2))
        .replace("{endX}", ex.toFixed(2))
        .replace("{endY}", ey.toFixed(2))
        .replace("{layers}", KI_PAD_LAYER[rect.layerId] || "F.Fab")
        .replace("{strokeWidth}", Math.max(rect.strokeWidth, 0.01).toFixed(2));
    }
  }

  // Emit pads, including custom polygon pads when needed.
  for (const pad of kiFootprint.pads) {
    let shape = KI_PAD_SHAPE[pad.shape] || "custom";
    let width = Math.max(pad.width, 0.01);
    let height = Math.max(pad.height, 0.01);
    let orientation = angleToKi(pad.rotation);
    let polygon = "";

    if (shape === "custom") {
      const points = pad.points.split(" ").map(fpToKi);
      if (points.length) {
        width = 0.005;
        height = 0.005;
        orientation = 0;
        const path = [];
        for (let i = 0; i < points.length; i += 2) {
          const x = (points[i] - kiFootprint.bbox.x) - (pad.centerX - kiFootprint.bbox.x);
          const y = (points[i + 1] - kiFootprint.bbox.y) - (pad.centerY - kiFootprint.bbox.y);
          path.push(`(xy ${x.toFixed(2)} ${y.toFixed(2)})`);
        }
        polygon =
          "\n\t\t(primitives \n\t\t\t(gr_poly \n\t\t\t\t(pts " +
          path.join(" ") +
          "\n\t\t\t\t) \n\t\t\t\t(width 0.1) \n\t\t\t)\n\t\t)\n\t";
      }
    }

    const layers =
      pad.holeRadius <= 0
        ? KI_PAD_LAYER[pad.layerId] || ""
        : KI_PAD_LAYER_THT[pad.layerId] || "";

    const drill = drillToKi(
      pad.holeRadius,
      pad.holeLength,
      height,
      width
    );

    let number = pad.number || "";
    if (number.includes("(") && number.includes(")")) {
      number = number.split("(")[1].split(")")[0];
    }

    output += KI_FOOTPRINT_TEMPLATES.pad
      .replace("{number}", number)
      .replace("{type}", pad.holeRadius > 0 ? "thru_hole" : "smd")
      .replace("{shape}", shape)
      .replace("{posX}", (pad.centerX - kiFootprint.bbox.x).toFixed(2))
      .replace("{posY}", (pad.centerY - kiFootprint.bbox.y).toFixed(2))
      .replace("{orientation}", orientation === "" ? "" : orientation.toFixed(2))
      .replace("{width}", width.toFixed(2))
      .replace("{height}", height.toFixed(2))
      .replace("{layers}", layers)
      .replace("{drill}", drill ? ` ${drill}` : "")
      .replace("{polygon}", polygon);
  }

  // Emit unplated mounting holes.
  for (const hole of kiFootprint.holes) {
    output += KI_FOOTPRINT_TEMPLATES.hole
      .replace("{posX}", (hole.centerX - kiFootprint.bbox.x).toFixed(2))
      .replace("{posY}", (hole.centerY - kiFootprint.bbox.y).toFixed(2))
      .replace("{size}", (hole.radius * 2).toFixed(2));
  }

  // Emit vias as through-hole pads with drill size.
  for (const via of kiFootprint.vias) {
    output += KI_FOOTPRINT_TEMPLATES.via
      .replace("{posX}", (via.centerX - kiFootprint.bbox.x).toFixed(2))
      .replace("{posY}", (via.centerY - kiFootprint.bbox.y).toFixed(2))
      .replace("{diameter}", via.diameter.toFixed(2))
      .replace("{size}", (via.radius * 2).toFixed(2));
  }

  // Emit circular graphics.
  for (const circle of kiFootprint.circles) {
    const cx = circle.cx - kiFootprint.bbox.x;
    const cy = circle.cy - kiFootprint.bbox.y;
    output += KI_FOOTPRINT_TEMPLATES.circle
      .replace("{cx}", cx.toFixed(2))
      .replace("{cy}", cy.toFixed(2))
      .replace("{endX}", (cx + circle.radius).toFixed(2))
      .replace("{endY}", cy.toFixed(2))
      .replace("{layers}", KI_LAYERS[circle.layerId] || "F.Fab")
      .replace("{strokeWidth}", Math.max(circle.strokeWidth, 0.01).toFixed(2));
  }

  // Emit arcs by converting SVG arc parameters into KiCad arc parameters.
  for (const arc of kiFootprint.arcs) {
    const arcPath = arc.path.replace(/,/g, " ").replace("M ", "M").replace("A ", "A");
    const [startXRaw, startYRaw] = arcPath.split("A")[0].slice(1).split(" ", 2);
    const startX = fpToKi(startXRaw) - kiFootprint.bbox.x;
    const startY = fpToKi(startYRaw) - kiFootprint.bbox.y;
    const arcParameters = arcPath.split("A")[1].replace(/\s+/g, " ").trim();
    const [
      svgRx,
      svgRy,
      xAxisRotation,
      largeArc,
      sweep,
      endXRaw,
      endYRaw
    ] = arcParameters.split(" ");
    const rotated = rotate(fpToKi(svgRx), fpToKi(svgRy), 0);
    const endX = fpToKi(endXRaw) - kiFootprint.bbox.x;
    const endY = fpToKi(endYRaw) - kiFootprint.bbox.y;
    let extent = 0;
    let cx = 0;
    let cy = 0;
    if (rotated.y !== 0) {
      const arcInfo = computeArc(
        startX,
        startY,
        rotated.x,
        rotated.y,
        toNumber(xAxisRotation),
        largeArc === "1",
        sweep === "1",
        endX,
        endY
      );
      cx = arcInfo.cx;
      cy = arcInfo.cy;
      extent = arcInfo.angleExtent;
    }

    output += KI_FOOTPRINT_TEMPLATES.arc
      .replace("{startX}", cx.toFixed(2))
      .replace("{startY}", cy.toFixed(2))
      .replace("{endX}", endX.toFixed(2))
      .replace("{endY}", endY.toFixed(2))
      .replace("{angle}", extent.toFixed(2))
      .replace("{layers}", KI_LAYERS[arc.layerId] || "F.Fab")
      .replace("{strokeWidth}", Math.max(fpToKi(arc.strokeWidth), 0.01).toFixed(2));
  }

  // Emit text items with proper mirroring and visibility.
  for (const text of kiFootprint.texts) {
    let layers = KI_LAYERS[text.layerId] || "F.Fab";
    if (text.type === "N") {
      layers = layers.replace(".SilkS", ".Fab");
    }
    const mirror = layers.startsWith("B") ? " mirror" : "";
    output += KI_FOOTPRINT_TEMPLATES.text
      .replace("{text}", text.text)
      .replace("{posX}", (text.centerX - kiFootprint.bbox.x).toFixed(2))
      .replace("{posY}", (text.centerY - kiFootprint.bbox.y).toFixed(2))
      .replace("{orientation}", angleToKi(text.rotation).toFixed(2))
      .replace("{layers}", layers)
      .replace("{display}", text.isDisplayed === false ? " hide" : "")
      .replace("{fontSize}", Math.max(text.fontSize, 1).toFixed(2))
      .replace("{thickness}", Math.max(text.strokeWidth, 0.01).toFixed(2))
      .replace("{mirror}", mirror);
  }

  // Attach 3D model reference if available.
  if (kiFootprint.model3d && model3dPath) {
    output += KI_FOOTPRINT_TEMPLATES.model3d
      .replace("{file3d}", `${model3dPath}/${kiFootprint.model3d.name}.wrl`)
      .replace("{posX}", kiFootprint.model3d.translation.x.toFixed(3))
      .replace("{posY}", kiFootprint.model3d.translation.y.toFixed(3))
      .replace("{posZ}", kiFootprint.model3d.translation.z.toFixed(3))
      .replace("{rotX}", kiFootprint.model3d.rotation.x.toFixed(0))
      .replace("{rotY}", kiFootprint.model3d.rotation.y.toFixed(0))
      .replace("{rotZ}", kiFootprint.model3d.rotation.z.toFixed(0));
  }

  output += ")";
  return output;
}

// Convert EasyEDA footprint values to millimeters with rounding.
function fpToKi(value) {
  const num = toNumber(value);
  return Number.isFinite(num) ? Math.round(num * 10 * 0.0254 * 100) / 100 : num;
}

// Convert OBJ + MTL data into a basic VRML file for KiCad.
function convertObjToWrl(objData) {
  // Parse material definitions so we can preserve colors.
  const materials = {};
  const materialMatches = objData.match(/newmtl[\s\S]*?endmtl/g) || [];
  for (const match of materialMatches) {
    const material = {};
    let materialId = "";
    for (const line of match.split(/\r?\n/)) {
      if (line.startsWith("newmtl")) {
        materialId = line.split(" ")[1];
      } else if (line.startsWith("Ka")) {
        material.ambient = line.split(" ").slice(1);
      } else if (line.startsWith("Kd")) {
        material.diffuse = line.split(" ").slice(1);
      } else if (line.startsWith("Ks")) {
        material.specular = line.split(" ").slice(1);
      } else if (line.startsWith("d")) {
        material.transparency = line.split(" ").slice(1);
      }
    }
    materials[materialId] = material;
  }

  // Convert vertices from OBJ units into KiCad-friendly units.
  const vertices = (objData.match(/^v\s+.*$/gm) || []).map((line) => {
    const coords = line
      .replace(/^v\s+/, "")
      .trim()
      .split(/\s+/)
      .map((value) => (Number(value) / 2.54).toFixed(4));
    return coords.join(" ");
  });

  let rawWrl =
    "#VRML V2.0 utf8\n# 3D model generated by easy EDA downloader\n";

  // Split by material and emit one VRML Shape per material group.
  const shapes = objData.split("usemtl").slice(1);
  for (const shape of shapes) {
    const lines = shape.split(/\r?\n/).filter(Boolean);
    if (!lines.length) {
      continue;
    }
    const material = materials[lines[0].replace(/\s+/g, "")] || {};
    const coordIndex = [];
    const points = [];
    const linkMap = new Map();
    let indexCounter = 0;

    // Convert each face into VRML coordIndex entries, de-duplicating vertices.
    for (const line of lines.slice(1)) {
      if (!line.startsWith("f ")) {
        continue;
      }
      const face = line
        .replace(/^f\s+/, "")
        .replace(/\/\//g, "/")
        .split(/\s+/)
        .map((part) => parseInt(part.split("/")[0], 10));

      const faceIndex = [];
      for (const idx of face) {
        if (!linkMap.has(idx)) {
          linkMap.set(idx, indexCounter);
          faceIndex.push(String(indexCounter));
          points.push(vertices[idx - 1]);
          indexCounter += 1;
        } else {
          faceIndex.push(String(linkMap.get(idx)));
        }
      }
      faceIndex.push("-1");
      coordIndex.push(faceIndex.join(" ") + ",");
    }
    if (points.length) {
      points.splice(points.length - 1, 0, points[points.length - 1]);
    }

    // Emit a VRML Shape with material and geometry.
    rawWrl += `
Shape{
    appearance Appearance {
        material  Material {
            diffuseColor ${(material.diffuse || []).join(" ")}
            specularColor ${(material.specular || []).join(" ")}
            ambientIntensity 0.2
            transparency 0
            shininess 0.5
        }
    }
    geometry IndexedFaceSet {
        ccw TRUE
        solid FALSE
        coord DEF co Coordinate {
            point [
                ${points.join(", ")}
            ]
        }
        coordIndex [
            ${coordIndex.join("")}
        ]
    }
}`;
  }

  return rawWrl;
}

// Public API: convert EasyEDA CAD data to KiCad symbol/footprint strings.
export function convertEasyedaCadToKicad(cadData, options = {}) {
  const result = {};

  // Build the symbol output if requested.
  if (options.symbol) {
    const eeSymbol = parseEasyedaSymbol(cadData);
    const kiSymbol = convertSymbolToKiCad(eeSymbol);
    result.symbol = {
      name: sanitizeFields(eeSymbol.info.name || "symbol"),
      content: exportKiCadSymbolLibrary(kiSymbol)
    };
  }

  // Build the footprint output if requested.
  if (options.footprint) {
    const eeFootprint = parseEasyedaFootprint(cadData);
    const kiFootprint = convertFootprintToKiCad(eeFootprint);
    result.footprint = {
      name: eeFootprint.info.name || "footprint",
      content: exportKiCadFootprint(kiFootprint, "${KIPRJMOD}")
    };
  }

  return result;
}

// Public API: convert a raw OBJ string into VRML text.
export function convertObjToWrlString(objData) {
  return convertObjToWrl(objData);
}
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
