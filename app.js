const palettes = [
  ["#171a18", "#fbfcf8", "#cf4e45", "#0f766e", "#dca83a", "#2d6cdf", "#7a4f9f", "#8fbf62"],
  ["#202020", "#f5f6ef", "#e2543f", "#176b87", "#f0b73e", "#5a8f5b", "#b7588a", "#545f75"],
  ["#121617", "#faf7f1", "#df6b4f", "#247b65", "#e0c45c", "#496db3", "#7d5a42", "#9f5075"],
  ["#1e2320", "#f7f7f2", "#d64f67", "#148a7a", "#c2a338", "#497f9f", "#6b5bb5", "#6e8d48"],
  ["#181a1d", "#f8f6f0", "#c84630", "#3b7d72", "#e3a62f", "#4169a8", "#89565a", "#7ca658"]
];

const boardCanvas = document.querySelector("#boardCanvas");
const boardContext = boardCanvas.getContext("2d");
const previewCanvas = document.querySelector("#previewCanvas");
const previewContext = previewCanvas.getContext("2d");
const swatches = document.querySelector("#swatches");
const statusText = document.querySelector("#statusText");
const colorText = document.querySelector("#colorText");
const undoButton = document.querySelector("#undoButton");
const redoButton = document.querySelector("#redoButton");
const exportButton = document.querySelector("#exportButton");
const randomButton = document.querySelector("#randomButton");
const paletteButton = document.querySelector("#paletteButton");
const clearButton = document.querySelector("#clearButton");
const invertButton = document.querySelector("#invertButton");
const exportText = document.querySelector("#exportText");
const seedButton = document.querySelector("#seedButton");
const seedInput = document.querySelector("#seedInput");
const generateButton = document.querySelector("#generateButton");
const copyButton = document.querySelector("#copyButton");
const loadButton = document.querySelector("#loadButton");
const designCode = document.querySelector("#designCode");
const toast = document.querySelector("#toast");

const storageKey = "glyph-forge-state";
const defaultSize = 24;
const modes = ["crest", "woven", "circuit", "bloom", "scatter"];
const exportModes = ["tile", "sheet", "wallpaper"];
const seedNames = ["ember", "loom", "signal", "glass", "orbit", "verdant", "copper", "signal", "mirth", "pixel"];

let state = {
  gridSize: defaultSize,
  cells: Array(defaultSize * defaultSize).fill(null),
  palette: [...palettes[0]],
  activeColor: palettes[0][2],
  tool: "paint",
  brush: 1,
  symmetry: "none",
  seed: "ember-2048",
  mode: "crest",
  exportMode: "tile"
};

let history = [];
let historyIndex = -1;
let isDrawing = false;
let activePointerId = null;
let editChanged = false;

function makeBlankCells(size) {
  return Array(size * size).fill(null);
}

function cloneCells(cells = state.cells) {
  return [...cells];
}

function normalizeState(saved) {
  if (!saved || typeof saved !== "object") {
    return null;
  }

  const size = Number(saved.gridSize);
  const palette = Array.isArray(saved.palette) && saved.palette.length >= 4 ? saved.palette : palettes[0];
  const expected = size * size;

  if (![12, 16, 24, 32].includes(size) || !Array.isArray(saved.cells) || saved.cells.length !== expected) {
    return null;
  }

  return {
    gridSize: size,
    cells: saved.cells.map((cell) => (typeof cell === "string" ? cell : null)),
    palette: [...palette],
    activeColor: typeof saved.activeColor === "string" ? saved.activeColor : palette[2],
    tool: ["paint", "erase", "fill", "pick"].includes(saved.tool) ? saved.tool : "paint",
    brush: [1, 2, 3, 4].includes(Number(saved.brush)) ? Number(saved.brush) : 1,
    symmetry: ["none", "vertical", "horizontal", "quadrant", "rotate"].includes(saved.symmetry) ? saved.symmetry : "none",
    seed: typeof saved.seed === "string" && saved.seed.trim() ? saved.seed : "ember-2048",
    mode: modes.includes(saved.mode) ? saved.mode : "crest",
    exportMode: exportModes.includes(saved.exportMode) ? saved.exportMode : "tile"
  };
}

function loadState() {
  try {
    const saved = normalizeState(JSON.parse(localStorage.getItem(storageKey)));
    if (saved) {
      state = saved;
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function createSnapshot() {
  return {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor,
    seed: state.seed,
    mode: state.mode,
    exportMode: state.exportMode
  };
}

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(createSnapshot());
  historyIndex = history.length - 1;
  updateUndoRedo();
}

function restoreSnapshot(snapshot) {
  state.cells = cloneCells(snapshot.cells);
  state.gridSize = snapshot.gridSize;
  state.palette = [...snapshot.palette];
  state.activeColor = snapshot.activeColor;
  state.seed = snapshot.seed || state.seed;
  state.mode = snapshot.mode || state.mode;
  state.exportMode = snapshot.exportMode || state.exportMode;
  saveState();
  syncControls();
  render();
}

function undo() {
  if (historyIndex <= 0) {
    return;
  }
  historyIndex -= 1;
  restoreSnapshot(history[historyIndex]);
  updateUndoRedo();
}

function redo() {
  if (historyIndex >= history.length - 1) {
    return;
  }
  historyIndex += 1;
  restoreSnapshot(history[historyIndex]);
  updateUndoRedo();
}

function updateUndoRedo() {
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex >= history.length - 1;
}

function indexFor(x, y) {
  return y * state.gridSize + x;
}

function colorAt(x, y) {
  return state.cells[indexFor(x, y)];
}

function setColor(x, y, color) {
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) {
    return false;
  }

  const index = indexFor(x, y);
  if (state.cells[index] === color) {
    return false;
  }
  state.cells[index] = color;
  return true;
}

function uniquePositions(positions) {
  const seen = new Set();
  return positions.filter(([x, y]) => {
    const key = `${x},${y}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function symmetryPositions(x, y) {
  const max = state.gridSize - 1;
  const positions = [[x, y]];

  if (state.symmetry === "vertical" || state.symmetry === "quadrant") {
    positions.push([max - x, y]);
  }

  if (state.symmetry === "horizontal" || state.symmetry === "quadrant") {
    positions.push([x, max - y]);
  }

  if (state.symmetry === "quadrant" || state.symmetry === "rotate") {
    positions.push([max - x, max - y]);
  }

  return uniquePositions(positions);
}

function brushPositions(x, y) {
  const offset = Math.floor((state.brush - 1) / 2);
  const positions = [];

  for (let dy = 0; dy < state.brush; dy += 1) {
    for (let dx = 0; dx < state.brush; dx += 1) {
      positions.push([x + dx - offset, y + dy - offset]);
    }
  }

  return positions.flatMap(([px, py]) => symmetryPositions(px, py));
}

function applyPaint(x, y) {
  let changed = false;
  const color = state.tool === "erase" ? null : state.activeColor;
  brushPositions(x, y).forEach(([px, py]) => {
    changed = setColor(px, py, color) || changed;
  });
  return changed;
}

function floodFill(x, y) {
  const target = colorAt(x, y);
  const replacement = state.tool === "erase" ? null : state.activeColor;
  if (target === replacement) {
    return false;
  }

  const queue = [[x, y]];
  const visited = new Set();
  let changed = false;

  while (queue.length) {
    const [cx, cy] = queue.shift();
    const key = `${cx},${cy}`;
    if (visited.has(key) || cx < 0 || cy < 0 || cx >= state.gridSize || cy >= state.gridSize) {
      continue;
    }
    visited.add(key);

    if (colorAt(cx, cy) !== target) {
      continue;
    }

    symmetryPositions(cx, cy).forEach(([px, py]) => {
      changed = setColor(px, py, replacement) || changed;
    });

    queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }

  return changed;
}

function pointFromEvent(event) {
  const rect = boardCanvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.gridSize);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.gridSize);

  return {
    x: Math.max(0, Math.min(state.gridSize - 1, x)),
    y: Math.max(0, Math.min(state.gridSize - 1, y))
  };
}

function handleDraw(event) {
  const { x, y } = pointFromEvent(event);

  if (state.tool === "pick") {
    const picked = colorAt(x, y);
    if (picked) {
      state.activeColor = picked;
      saveState();
      syncControls();
    }
    return false;
  }

  if (state.tool === "fill") {
    return floodFill(x, y);
  }

  return applyPaint(x, y);
}

function startDrawing(event) {
  event.preventDefault();
  activePointerId = event.pointerId;
  boardCanvas.setPointerCapture(activePointerId);
  isDrawing = true;
  editChanged = false;

  if (state.tool !== "pick") {
    pushHistory();
  }

  editChanged = handleDraw(event);
  if (editChanged) {
    commitEdit();
  } else {
    render();
  }

  if (state.tool === "fill" || state.tool === "pick") {
    stopDrawing(event);
  }
}

function continueDrawing(event) {
  if (!isDrawing || event.pointerId !== activePointerId || state.tool === "fill" || state.tool === "pick") {
    return;
  }

  event.preventDefault();
  if (handleDraw(event)) {
    editChanged = true;
    render();
    saveState();
  }
}

function stopDrawing(event) {
  if (!isDrawing || event.pointerId !== activePointerId) {
    return;
  }

  isDrawing = false;
  if (boardCanvas.hasPointerCapture(activePointerId)) {
    boardCanvas.releasePointerCapture(activePointerId);
  }
  activePointerId = null;

  if (editChanged) {
    history[historyIndex] = createSnapshot();
    saveState();
    updateUndoRedo();
  } else if (state.tool !== "pick") {
    history.pop();
    historyIndex = history.length - 1;
    updateUndoRedo();
  }
}

function commitEdit() {
  render();
  saveState();
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeCells() {
  return state.cells.map((cell) => {
    if (!cell) {
      return ".";
    }
    const index = state.palette.indexOf(cell);
    return index >= 0 ? index.toString(36) : ".";
  }).join("");
}

function decodeCells(encoded, palette, size) {
  if (typeof encoded !== "string" || encoded.length !== size * size) {
    throw new Error("Bad cell data");
  }

  return [...encoded].map((cell) => {
    if (cell === ".") {
      return null;
    }
    return palette[parseInt(cell, 36)] || null;
  });
}

function encodeDesign() {
  const payload = {
    v: 1,
    s: state.gridSize,
    p: state.palette,
    a: state.palette.indexOf(state.activeColor),
    seed: state.seed,
    mode: state.mode,
    export: state.exportMode,
    tool: state.tool,
    brush: state.brush,
    sym: state.symmetry,
    c: encodeCells()
  };

  return `GF1.${base64UrlEncode(JSON.stringify(payload))}`;
}

function decodeDesign(code) {
  const cleaned = code.trim();
  if (!cleaned.startsWith("GF1.")) {
    throw new Error("Unknown design code");
  }

  const payload = JSON.parse(base64UrlDecode(cleaned.slice(4)));
  const size = Number(payload.s);
  const palette = Array.isArray(payload.p) && payload.p.length >= 4 ? payload.p : palettes[0];

  if (!payload || payload.v !== 1 || ![12, 16, 24, 32].includes(size)) {
    throw new Error("Unsupported design code");
  }

  return {
    gridSize: size,
    cells: decodeCells(payload.c, palette, size),
    palette: [...palette],
    activeColor: palette[payload.a] || palette[2] || palette[0],
    seed: typeof payload.seed === "string" && payload.seed.trim() ? payload.seed : createSeed(),
    mode: modes.includes(payload.mode) ? payload.mode : "crest",
    exportMode: exportModes.includes(payload.export) ? payload.export : "tile",
    tool: ["paint", "erase", "fill", "pick"].includes(payload.tool) ? payload.tool : state.tool,
    brush: [1, 2, 3, 4].includes(Number(payload.brush)) ? Number(payload.brush) : state.brush,
    symmetry: ["none", "vertical", "horizontal", "quadrant", "rotate"].includes(payload.sym) ? payload.sym : state.symmetry
  };
}

function refreshDesignCode() {
  if (document.activeElement !== designCode) {
    designCode.value = encodeDesign();
  }
}

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("active");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("active");
  }, 1800);
}

function copyDesign() {
  const code = encodeDesign();
  designCode.value = code;
  designCode.select();

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code).then(() => showToast("Copied")).catch(() => showToast("Code ready"));
  } else {
    showToast("Code ready");
  }
}

function loadDesign() {
  let decoded;
  try {
    decoded = decodeDesign(designCode.value);
  } catch {
    showToast("Invalid code");
    return;
  }

  pushHistory();
  state.gridSize = decoded.gridSize;
  state.cells = decoded.cells;
  state.palette = decoded.palette;
  state.activeColor = decoded.activeColor;
  state.seed = decoded.seed;
  state.mode = decoded.mode;
  state.exportMode = decoded.exportMode;
  state.tool = decoded.tool;
  state.brush = decoded.brush;
  state.symmetry = decoded.symmetry;
  history[historyIndex] = createSnapshot();
  saveState();
  syncControls();
  render();
  showToast("Loaded");
}

function setActiveButton(container, selector, value) {
  document.querySelectorAll(`${container} .segment`).forEach((button) => {
    const isActive = button.matches(`[${selector}="${value}"]`);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncControls() {
  setActiveButton("#toolButtons", "data-tool", state.tool);
  setActiveButton("#brushButtons", "data-brush", String(state.brush));
  setActiveButton("#symmetryButtons", "data-symmetry", state.symmetry);
  setActiveButton("#gridButtons", "data-size", String(state.gridSize));
  setActiveButton("#modeButtons", "data-mode", state.mode);
  setActiveButton("#exportButtons", "data-export", state.exportMode);
  renderSwatches();
  seedInput.value = state.seed;
  statusText.textContent = `${state.gridSize} x ${state.gridSize} tile`;
  colorText.textContent = `Color ${state.activeColor}`;
  exportText.textContent = `Export ${titleCase(state.exportMode)}`;
  refreshDesignCode();
}

function renderSwatches() {
  swatches.innerHTML = "";
  state.palette.forEach((color) => {
    const button = document.createElement("button");
    button.className = `swatch${color === state.activeColor ? " active" : ""}`;
    button.type = "button";
    button.style.background = color;
    button.setAttribute("aria-label", color);
    button.setAttribute("aria-pressed", String(color === state.activeColor));
    button.addEventListener("click", () => {
      state.activeColor = color;
      saveState();
      syncControls();
    });
    swatches.append(button);
  });
}

function resizeCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawTile(context, width, height, includeGrid = false) {
  const cell = width / state.gridSize;
  context.fillStyle = state.palette[1] || "#fbfcf8";
  context.fillRect(0, 0, width, height);

  state.cells.forEach((color, index) => {
    if (!color) {
      return;
    }
    const x = index % state.gridSize;
    const y = Math.floor(index / state.gridSize);
    context.fillStyle = color;
    context.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
  });

  if (!includeGrid) {
    return;
  }

  context.strokeStyle = "rgba(23, 26, 24, 0.12)";
  context.lineWidth = 1;
  for (let line = 0; line <= state.gridSize; line += 1) {
    const position = Math.round(line * cell) + 0.5;
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, height);
    context.moveTo(0, position);
    context.lineTo(width, position);
    context.stroke();
  }
}

function renderBoard() {
  const { width, height } = resizeCanvas(boardCanvas, boardContext);
  boardContext.clearRect(0, 0, width, height);
  drawTile(boardContext, width, height, true);
}

function renderPreview() {
  const { width, height } = resizeCanvas(previewCanvas, previewContext);
  const tileSize = width / 3;
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tileContext = tile.getContext("2d");

  drawTile(tileContext, tileSize, tileSize, false);
  const pattern = previewContext.createPattern(tile, "repeat");
  previewContext.clearRect(0, 0, width, height);
  previewContext.fillStyle = pattern;
  previewContext.fillRect(0, 0, width, height);
  previewContext.strokeStyle = "rgba(23, 26, 24, 0.28)";
  previewContext.lineWidth = 2;
  previewContext.strokeRect(tileSize, tileSize, tileSize, tileSize);
}

function render() {
  renderBoard();
  renderPreview();
  refreshDesignCode();
}

function changeGridSize(size) {
  if (size === state.gridSize) {
    return;
  }

  pushHistory();
  state.gridSize = size;
  state.cells = makeBlankCells(size);
  history[historyIndex] = createSnapshot();
  saveState();
  syncControls();
  render();
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomChoiceFrom(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function createSeed() {
  const name = randomChoice(seedNames);
  return `${name}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function titleCase(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function localIndex(x, y, size) {
  return y * size + x;
}

function localMirrorPositions(x, y, size, mode = "quadrant") {
  const max = size - 1;
  const positions = [[x, y]];

  if (mode === "vertical" || mode === "quadrant") {
    positions.push([max - x, y]);
  }

  if (mode === "horizontal" || mode === "quadrant") {
    positions.push([x, max - y]);
  }

  if (mode === "quadrant" || mode === "rotate") {
    positions.push([max - x, max - y]);
  }

  return uniquePositions(positions);
}

function createGeneratorContext(seed, mode) {
  const size = state.gridSize;
  const cells = makeBlankCells(size);
  const colorList = state.palette.filter((color) => color !== state.palette[1]);
  const colors = {
    ink: state.palette[0] || "#171a18",
    paper: state.palette[1] || "#fbfcf8",
    warm: state.palette[2] || "#cf4e45",
    teal: state.palette[3] || "#0f766e",
    gold: state.palette[4] || "#dca83a",
    blue: state.palette[5] || "#2d6cdf",
    purple: state.palette[6] || "#7a4f9f",
    green: state.palette[7] || "#8fbf62"
  };
  const rng = createRng(`${mode}:${seed}:${size}:${state.palette.join("")}`);

  const set = (x, y, color) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= size || py >= size) {
      return;
    }
    cells[localIndex(px, py, size)] = color;
  };

  const mirror = (x, y, color, mirrorMode = "quadrant") => {
    localMirrorPositions(Math.round(x), Math.round(y), size, mirrorMode).forEach(([px, py]) => set(px, py, color));
  };

  const line = (x1, y1, x2, y2, color, mirrorMode = "none") => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x1 + ((x2 - x1) * step) / steps);
      const y = Math.round(y1 + ((y2 - y1) * step) / steps);
      if (mirrorMode === "none") {
        set(x, y, color);
      } else {
        mirror(x, y, color, mirrorMode);
      }
    }
  };

  return { cells, colorList, colors, line, mirror, rng, set, size };
}

function generateCrest(context) {
  const { colors, line, mirror, rng, set, size } = context;
  const center = (size - 1) / 2;
  const variant = randomInt(rng, 0, 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);

      if (dx <= size * 0.07 && dy <= size * 0.25) {
        set(x, y, colors.warm);
      }
      if (dy <= size * 0.08 && dx <= size * 0.3) {
        set(x, y, colors.teal);
      }
      if (dy > size * 0.13 && dy < size * 0.22 && dx <= size * 0.24) {
        set(x, y, variant === 1 ? colors.gold : colors.warm);
      }
      if (Math.abs(dx + dy - size * 0.34) <= 1 && dy < size * 0.36) {
        set(x, y, colors.gold);
      }
    }
  }

  for (let mark = 0; mark < Math.max(4, size / 4); mark += 1) {
    const x = randomInt(rng, 1, Math.floor(size * 0.28));
    const y = randomInt(rng, 1, Math.floor(size * 0.28));
    mirror(x, y, randomChoiceFrom([colors.teal, colors.green, colors.blue], rng), "quadrant");
  }

  line(Math.floor(size * 0.18), Math.floor(size * 0.5), Math.floor(size * 0.38), Math.floor(size * 0.5), colors.ink, "vertical");
  line(Math.floor(size * 0.5), Math.floor(size * 0.18), Math.floor(size * 0.5), Math.floor(size * 0.31), colors.green, "horizontal");
}

function generateWoven(context) {
  const { colors, line, mirror, rng, set, size } = context;
  const gap = Math.max(4, Math.floor(size / 5));
  const horizontalStart = randomInt(rng, 2, 3);
  const verticalStart = randomInt(rng, 2, 3);

  for (let y = horizontalStart; y < size - 2; y += gap) {
    const color = y % 2 === 0 ? colors.green : colors.gold;
    for (let band = 0; band < 2; band += 1) {
      line(1, y + band, size - 2, y + band, color);
    }
  }

  for (let x = verticalStart; x < size - 2; x += gap) {
    const color = x % 2 === 0 ? colors.teal : colors.blue;
    for (let y = 1; y < size - 1; y += 1) {
      const over = (Math.floor(x / gap) + Math.floor(y / gap)) % 2 === 0;
      if (over || y % gap < 2) {
        set(x, y, color);
        set(x + 1, y, color);
      }
    }
  }

  for (let knot = 0; knot < Math.max(4, size / 5); knot += 1) {
    mirror(randomInt(rng, 2, Math.floor(size / 2)), randomInt(rng, 2, Math.floor(size / 2)), colors.warm, "quadrant");
  }
}

function generateCircuit(context) {
  const { colors, line, mirror, rng, size } = context;
  const traceColors = [colors.teal, colors.blue, colors.green, colors.ink];
  const half = Math.floor(size / 2) - 1;
  const traces = Math.max(5, Math.floor(size / 4));

  for (let trace = 0; trace < traces; trace += 1) {
    let x = randomInt(rng, 1, 3);
    let y = randomInt(rng, 1, half);
    const color = randomChoiceFrom(traceColors, rng);

    while (x < half) {
      const nextX = Math.min(half, x + randomInt(rng, 2, 5));
      line(x, y, nextX, y, color, "quadrant");
      if (rng() > 0.35) {
        const nextY = Math.max(1, Math.min(half, y + randomInt(rng, -3, 3)));
        line(nextX, y, nextX, nextY, color, "quadrant");
        y = nextY;
      }
      if (rng() > 0.62) {
        mirror(nextX, y, randomChoiceFrom([colors.gold, colors.warm, colors.purple], rng), "quadrant");
      }
      x = nextX + randomInt(rng, 1, 2);
    }
  }

  line(Math.floor(size * 0.25), Math.floor(size * 0.5), Math.floor(size * 0.75), Math.floor(size * 0.5), colors.ink);
  line(Math.floor(size * 0.5), Math.floor(size * 0.25), Math.floor(size * 0.5), Math.floor(size * 0.75), colors.teal);
}

function generateBloom(context) {
  const { colors, rng, set, size } = context;
  const center = (size - 1) / 2;
  const petals = randomChoiceFrom([4, 6, 8], rng);
  const phase = rng() * Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const wave = Math.cos(angle * petals + phase);

      if (distance <= size * 0.08) {
        set(x, y, colors.gold);
      } else if (distance <= size * 0.24 && wave > -0.18) {
        set(x, y, colors.warm);
      } else if (distance <= size * 0.34 && wave > 0.52) {
        set(x, y, colors.purple);
      } else if (distance > size * 0.24 && distance <= size * 0.46 && wave < -0.42) {
        set(x, y, colors.green);
      }
    }
  }

  const vineY = Math.floor(size * 0.18);
  for (let x = 2; x < size - 2; x += 1) {
    if ((x + Math.floor(phase * 10)) % 3 !== 0) {
      set(x, vineY, colors.teal);
      set(x, size - 1 - vineY, colors.teal);
    }
  }
}

function generateScatter(context) {
  const { colorList, colors, line, mirror, rng, size } = context;
  const density = 0.13 + rng() * 0.17;
  const half = Math.ceil(size / 2);

  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      if (rng() < density) {
        mirror(x, y, randomChoiceFrom(colorList, rng), "quadrant");
      }
    }
  }

  for (let stripe = 0; stripe < 3; stripe += 1) {
    const y = randomInt(rng, 2, half);
    line(1, y, half - 1, y, randomChoiceFrom([colors.teal, colors.green, colors.gold], rng), "quadrant");
  }
}

function createGeneratedCells(mode, seed) {
  const context = createGeneratorContext(seed, mode);
  const generators = {
    bloom: generateBloom,
    circuit: generateCircuit,
    crest: generateCrest,
    scatter: generateScatter,
    woven: generateWoven
  };

  generators[mode](context);
  return context.cells;
}

function generatePattern({ freshSeed = false, message = "", nextMode = state.mode } = {}) {
  pushHistory();
  state.mode = nextMode;
  state.seed = freshSeed ? createSeed() : seedInput.value.trim() || state.seed || createSeed();
  state.cells = createGeneratedCells(state.mode, state.seed);
  history[historyIndex] = createSnapshot();
  saveState();
  syncControls();
  render();
  showToast(message || `${titleCase(state.mode)} ready`);
}

function shuffleTile() {
  generatePattern({ freshSeed: true, message: "Shuffled" });
}

function rotatePalette() {
  pushHistory();
  const current = state.palette.join("");
  let next = randomChoice(palettes);

  if (palettes.length > 1) {
    while (next.join("") === current) {
      next = randomChoice(palettes);
    }
  }

  const oldPalette = [...state.palette];
  state.palette = [...next];
  state.cells = state.cells.map((cell) => {
    const index = oldPalette.indexOf(cell);
    return index >= 0 ? state.palette[index] : cell;
  });
  state.activeColor = state.palette[Math.min(Math.max(2, oldPalette.indexOf(state.activeColor)), state.palette.length - 1)];
  history[historyIndex] = createSnapshot();
  saveState();
  syncControls();
  render();
}

function clearTile() {
  pushHistory();
  state.cells = makeBlankCells(state.gridSize);
  history[historyIndex] = createSnapshot();
  saveState();
  render();
}

function invertMarks() {
  pushHistory();
  const filled = state.cells.filter(Boolean);
  const fallback = state.activeColor;
  state.cells = state.cells.map((cell, index) => {
    if (!cell) {
      return filled[index % Math.max(1, filled.length)] || fallback;
    }
    return null;
  });
  history[historyIndex] = createSnapshot();
  saveState();
  render();
}

function safeFilePart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pattern";
}

function createTileCanvas(pixelSize) {
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = pixelSize;
  tileCanvas.height = pixelSize;
  const tileContext = tileCanvas.getContext("2d");
  tileContext.imageSmoothingEnabled = false;
  drawTile(tileContext, pixelSize, pixelSize, false);
  return tileCanvas;
}

function fillWithTile(context, width, height, tileSize) {
  const tile = createTileCanvas(tileSize);
  const pattern = context.createPattern(tile, "repeat");
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
}

function downloadCanvas(canvas, label) {
  const link = document.createElement("a");
  link.download = `glyph-forge-${safeFilePart(state.seed)}-${label}.png`;
  link.href = canvas.toDataURL("image/png");
  document.body.append(link);
  link.click();
  link.remove();
}

function exportPng() {
  const exportCanvas = document.createElement("canvas");
  const exportContext = exportCanvas.getContext("2d");
  exportContext.imageSmoothingEnabled = false;

  if (state.exportMode === "tile") {
    const scale = 32;
    exportCanvas.width = state.gridSize * scale;
    exportCanvas.height = state.gridSize * scale;
    drawTile(exportContext, exportCanvas.width, exportCanvas.height, false);
    downloadCanvas(exportCanvas, "tile");
    showToast("Tile exported");
    return;
  }

  if (state.exportMode === "sheet") {
    exportCanvas.width = 2048;
    exportCanvas.height = 2048;
    fillWithTile(exportContext, exportCanvas.width, exportCanvas.height, 512);
    downloadCanvas(exportCanvas, "sheet");
    showToast("Sheet exported");
    return;
  }

  exportCanvas.width = 1920;
  exportCanvas.height = 1080;
  fillWithTile(exportContext, exportCanvas.width, exportCanvas.height, 360);
  downloadCanvas(exportCanvas, "wallpaper");
  showToast("Wallpaper exported");
}

function bindSegmentedControls() {
  document.querySelector("#toolButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (!button) {
      return;
    }
    state.tool = button.dataset.tool;
    saveState();
    syncControls();
  });

  document.querySelector("#brushButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-brush]");
    if (!button) {
      return;
    }
    state.brush = Number(button.dataset.brush);
    saveState();
    syncControls();
  });

  document.querySelector("#symmetryButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-symmetry]");
    if (!button) {
      return;
    }
    state.symmetry = button.dataset.symmetry;
    saveState();
    syncControls();
  });

  document.querySelector("#gridButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-size]");
    if (!button) {
      return;
    }
    changeGridSize(Number(button.dataset.size));
  });

  document.querySelector("#modeButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }
    generatePattern({ nextMode: button.dataset.mode });
  });

  document.querySelector("#exportButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (!button) {
      return;
    }
    state.exportMode = button.dataset.export;
    saveState();
    syncControls();
    showToast(`${titleCase(state.exportMode)} selected`);
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if ((event.metaKey || event.ctrlKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }

    if ((event.metaKey || event.ctrlKey) && key === "y") {
      event.preventDefault();
      redo();
    }

    if (["1", "2", "3", "4"].includes(event.key)) {
      state.brush = Number(event.key);
      saveState();
      syncControls();
    }
  });
}

function init() {
  loadState();
  bindSegmentedControls();
  bindKeyboard();

  boardCanvas.addEventListener("pointerdown", startDrawing);
  boardCanvas.addEventListener("pointermove", continueDrawing);
  boardCanvas.addEventListener("pointerup", stopDrawing);
  boardCanvas.addEventListener("pointercancel", stopDrawing);
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  exportButton.addEventListener("click", exportPng);
  randomButton.addEventListener("click", shuffleTile);
  paletteButton.addEventListener("click", rotatePalette);
  seedButton.addEventListener("click", () => generatePattern({ freshSeed: true, message: "New seed" }));
  generateButton.addEventListener("click", () => generatePattern());
  copyButton.addEventListener("click", copyDesign);
  loadButton.addEventListener("click", loadDesign);
  seedInput.addEventListener("change", () => {
    state.seed = seedInput.value.trim() || state.seed || createSeed();
    saveState();
    syncControls();
  });
  seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      generatePattern();
    }
  });
  clearButton.addEventListener("click", clearTile);
  invertButton.addEventListener("click", invertMarks);
  window.addEventListener("resize", render);

  pushHistory();
  syncControls();
  render();
}

init();
