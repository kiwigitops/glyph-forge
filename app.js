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

const storageKey = "glyph-forge-state";
const defaultSize = 24;

let state = {
  gridSize: defaultSize,
  cells: Array(defaultSize * defaultSize).fill(null),
  palette: [...palettes[0]],
  activeColor: palettes[0][2],
  tool: "paint",
  brush: 1,
  symmetry: "none"
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
    symmetry: ["none", "vertical", "horizontal", "quadrant", "rotate"].includes(saved.symmetry) ? saved.symmetry : "none"
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

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push({
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  });
  historyIndex = history.length - 1;
  updateUndoRedo();
}

function restoreSnapshot(snapshot) {
  state.cells = cloneCells(snapshot.cells);
  state.gridSize = snapshot.gridSize;
  state.palette = [...snapshot.palette];
  state.activeColor = snapshot.activeColor;
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
    history[historyIndex] = {
      cells: cloneCells(),
      gridSize: state.gridSize,
      palette: [...state.palette],
      activeColor: state.activeColor
    };
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
  renderSwatches();
  statusText.textContent = `${state.gridSize} x ${state.gridSize} tile`;
  colorText.textContent = `Color ${state.activeColor}`;
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
}

function changeGridSize(size) {
  if (size === state.gridSize) {
    return;
  }

  pushHistory();
  state.gridSize = size;
  state.cells = makeBlankCells(size);
  history[historyIndex] = {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  };
  saveState();
  syncControls();
  render();
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleTile() {
  pushHistory();
  const marks = makeBlankCells(state.gridSize);
  const density = 0.18 + Math.random() * 0.18;
  const colorChoices = state.palette.filter((color) => color !== state.palette[1]);

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      if (Math.random() < density) {
        const color = randomChoice(colorChoices);
        symmetryPositions(x, y).forEach(([px, py]) => {
          marks[indexFor(px, py)] = color;
        });
      }
    }
  }

  state.cells = marks;
  history[historyIndex] = {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  };
  saveState();
  render();
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
  history[historyIndex] = {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  };
  saveState();
  syncControls();
  render();
}

function clearTile() {
  pushHistory();
  state.cells = makeBlankCells(state.gridSize);
  history[historyIndex] = {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  };
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
  history[historyIndex] = {
    cells: cloneCells(),
    gridSize: state.gridSize,
    palette: [...state.palette],
    activeColor: state.activeColor
  };
  saveState();
  render();
}

function exportPng() {
  const scale = 32;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = state.gridSize * scale;
  exportCanvas.height = state.gridSize * scale;
  const exportContext = exportCanvas.getContext("2d");

  drawTile(exportContext, exportCanvas.width, exportCanvas.height, false);

  const link = document.createElement("a");
  link.download = `glyph-forge-${state.gridSize}x${state.gridSize}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  document.body.append(link);
  link.click();
  link.remove();
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
  clearButton.addEventListener("click", clearTile);
  invertButton.addEventListener("click", invertMarks);
  window.addEventListener("resize", render);

  pushHistory();
  syncControls();
  render();
}

init();
