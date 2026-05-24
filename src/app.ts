import {
  animateSprite,
  checkHealth,
  deleteProject,
  generateSprite,
  getCurrentProject,
  listProjects,
  loadProject,
  newProject,
  saveProject,
  saveSelection,
  saveSpritesheet,
} from "./lib/api";
import { Store, cacheBust, createInitialState, hydrateFromView } from "./lib/state";
import { composeSpritesheet, downloadDataUrl, loadImage } from "./lib/spritesheet";
import {
  chevronIcon,
  downloadIcon,
  folderIcon,
  frameIcon,
  gridIcon,
  plusIcon,
  saveIcon,
  sparkleIcon,
  trashIcon,
} from "./components/icons";

const EMPTY_PLACEHOLDER_SLOTS = 8;
const SELECTION_DEBOUNCE_MS = 700;

export function mountApp(root: HTMLElement) {
  const store = new Store(createInitialState());
  root.innerHTML = renderShell();

  const toast = createToast(root);

  // ---- Refs ----
  const promptInput = root.querySelector<HTMLTextAreaElement>("#sprite-prompt")!;
  const generateSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sprite")!;
  const spritePreview = root.querySelector<HTMLDivElement>("#sprite-preview")!;
  const spriteCaption = root.querySelector<HTMLDivElement>("#sprite-caption")!;
  const spriteStatus = root.querySelector<HTMLDivElement>("#sprite-status")!;

  const motionInput = root.querySelector<HTMLTextAreaElement>("#motion-prompt")!;
  const generateFramesBtn = root.querySelector<HTMLButtonElement>("#btn-generate-frames")!;
  const framesGrid = root.querySelector<HTMLDivElement>("#frames-grid")!;
  const framesStatus = root.querySelector<HTMLDivElement>("#frames-status")!;
  const generateSheetBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sheet")!;

  const sheetPreview = root.querySelector<HTMLDivElement>("#sheet-preview")!;
  const sheetMeta = root.querySelector<HTMLDivElement>("#sheet-meta")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("#btn-export")!;
  const gifPreview = root.querySelector<HTMLDivElement>("#gif-preview")!;

  const projectLabel = root.querySelector<HTMLSpanElement>("#project-label")!;
  const newBtn = root.querySelector<HTMLButtonElement>("#btn-new-project")!;
  const saveBtn = root.querySelector<HTMLButtonElement>("#btn-save-project")!;
  const loadBtn = root.querySelector<HTMLButtonElement>("#btn-load-project")!;
  const loadMenu = root.querySelector<HTMLDivElement>("#load-menu")!;

  // ---- Event handlers ----
  promptInput.addEventListener("input", () => {
    store.set({ spritePrompt: promptInput.value });
  });

  motionInput.addEventListener("input", () => {
    store.set({ motionPrompt: motionInput.value });
  });

  generateSpriteBtn.addEventListener("click", async () => {
    const prompt = store.get().spritePrompt.trim();
    if (!prompt) {
      setStatus(spriteStatus, "Enter a sprite prompt first.", "error");
      return;
    }
    store.set({ status: "generating-image", errorMessage: null });
    setStatus(spriteStatus, `${spinner()}Generating reference sprite…`);
    try {
      const result = await generateSprite(prompt);
      const img = await loadImage(result.dataUrl);
      store.set({
        status: "idle",
        spriteSrc: result.dataUrl,
        spriteDimensions: { w: img.naturalWidth, h: img.naturalHeight },
        frames: [],
        selectedFrameIndices: new Set(),
        spritesheetSrc: null,
        spritesheetCols: null,
        previewGifSrc: null,
        previewGifBuilding: false,
      });
      setStatus(spriteStatus, "Reference sprite ready.", "success");
      toast("Reference sprite generated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate sprite";
      store.set({ status: "error", errorMessage: message });
      setStatus(spriteStatus, message, "error");
    }
  });

  generateFramesBtn.addEventListener("click", async () => {
    const state = store.get();
    if (!state.spriteSrc) {
      setStatus(framesStatus, "Generate a reference sprite first.", "error");
      return;
    }
    const text = state.motionPrompt.trim();
    if (!text) {
      setStatus(framesStatus, "Enter a movement prompt first.", "error");
      return;
    }
    store.set({ status: "generating-video", errorMessage: null });
    setStatus(framesStatus, `${spinner()}Generating motion video…`);
    try {
      const view = await animateSprite(state.spriteSrc, text);
      const v = view.updatedAt;
      store.set({
        status: "done",
        frames: view.frames.map((f) => cacheBust(f, v)!),
        selectedFrameIndices: new Set(view.selectedFrameIndices),
        spritesheetSrc: null,
        spritesheetCols: null,
        previewGifSrc: null,
        previewGifBuilding: false,
      });
      setStatus(framesStatus, `Extracted ${view.frames.length} frames.`, "success");
      toast("Frames extracted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate frames";
      store.set({ status: "error", errorMessage: message });
      setStatus(framesStatus, message, "error");
    }
  });

  framesGrid.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(".frame-tile");
    if (!tile) return;
    const idxStr = tile.dataset.index;
    if (idxStr === undefined) return;
    const index = Number(idxStr);
    const state = store.get();
    if (index >= state.frames.length) return;
    const next = new Set(state.selectedFrameIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    store.set({ selectedFrameIndices: next });
    scheduleSelectionPersist();
  });

  generateSheetBtn.addEventListener("click", async () => {
    const state = store.get();
    const selected = [...state.selectedFrameIndices]
      .sort((a, b) => a - b)
      .map((i) => state.frames[i])
      .filter(Boolean);
    if (selected.length === 0) {
      setStatus(framesStatus, "Select at least one frame to include.", "error");
      return;
    }
    setStatus(framesStatus, `${spinner()}Composing spritesheet…`);
    try {
      const sheet = await composeSpritesheet({ frameSrcs: selected });
      store.set({
        spritesheetSrc: sheet.dataUrl,
        spritesheetCols: sheet.cols,
        previewGifSrc: null,
        previewGifBuilding: true,
        status: "done",
      });
      setStatus(
        framesStatus,
        `${spinner()}Spritesheet ready — building animated preview…`,
      );
      toast("Spritesheet ready");

      try {
        const view = await saveSpritesheet(sheet.dataUrl);
        const gifSrc = view.previewGifUrl
          ? `${view.previewGifUrl}?v=${encodeURIComponent(view.updatedAt)}`
          : null;
        store.set({ previewGifSrc: gifSrc, previewGifBuilding: false });
        if (gifSrc) {
          setStatus(framesStatus, "Spritesheet and preview ready.", "success");
        } else {
          setStatus(
            framesStatus,
            "Spritesheet ready (animated preview failed — see server log).",
            "success",
          );
        }
      } catch (err) {
        store.set({ previewGifBuilding: false });
        console.warn("[client] failed to persist spritesheet/gif", err);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compose spritesheet";
      setStatus(framesStatus, message, "error");
    }
  });

  exportBtn.addEventListener("click", () => {
    const src = store.get().spritesheetSrc;
    if (!src) {
      toast("Generate the spritesheet first");
      return;
    }
    if (src.startsWith("data:")) {
      downloadDataUrl(src, "spritesheet.png");
    } else {
      const a = document.createElement("a");
      a.href = src;
      a.download = "spritesheet.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  // ---- New / Save / Load wiring ----
  newBtn.addEventListener("click", async () => {
    const state = store.get();
    const hasWork =
      state.spriteSrc !== null ||
      state.frames.length > 0 ||
      state.spritePrompt.trim().length > 0 ||
      state.motionPrompt.trim().length > 0;
    if (hasWork && !window.confirm("Discard the current project and start fresh? Unsaved work will be lost.")) {
      return;
    }
    try {
      const view = await newProject();
      applyView(view);
      setStatus(spriteStatus, "", "info");
      setStatus(framesStatus, "", "info");
      toast("Started a new project");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start new project";
      toast(message);
    }
  });

  saveBtn.addEventListener("click", async () => {
    const suggested = store.get().currentProjectName === "latest" ? "" : store.get().currentProjectName;
    const raw = window.prompt(
      "Save project as (letters, numbers, hyphen, underscore — max 40 chars):",
      suggested,
    );
    if (raw === null) return;
    const name = raw.trim();
    if (!name) return;

    const existing = store.get().savedProjects.find((p) => p.name === name);
    if (existing && !window.confirm(`Project '${name}' exists. Overwrite?`)) {
      return;
    }

    try {
      const view = await saveProject(name);
      store.set({
        currentProjectName: view.name,
        savedProjects: await listProjects(),
      });
      toast(`Saved as '${name}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast(message);
    }
  });

  loadBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const open = loadMenu.classList.toggle("is-open");
    if (open) {
      try {
        const projects = await listProjects();
        store.set({ savedProjects: projects });
      } catch (err) {
        console.warn("[client] listProjects failed", err);
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!loadMenu.contains(e.target as Node) && e.target !== loadBtn) {
      loadMenu.classList.remove("is-open");
    }
  });

  loadMenu.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-load-name]");
    const del = target.closest<HTMLElement>("[data-delete-name]");

    if (del) {
      e.stopPropagation();
      const name = del.dataset.deleteName!;
      if (!window.confirm(`Delete saved project '${name}'? This can't be undone.`)) return;
      try {
        await deleteProject(name);
        store.set({ savedProjects: await listProjects() });
        toast(`Deleted '${name}'`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Delete failed";
        toast(message);
      }
      return;
    }

    if (item) {
      const name = item.dataset.loadName!;
      loadMenu.classList.remove("is-open");
      try {
        const view = await loadProject(name);
        applyView(view);
        toast(`Loaded '${name}'`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Load failed";
        toast(message);
      }
    }
  });

  // ---- Debounced selection persistence ----
  let selectionTimer: number | undefined;
  function scheduleSelectionPersist() {
    if (selectionTimer) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const indices = [...store.get().selectedFrameIndices].sort((a, b) => a - b);
      saveSelection(indices).catch((err) => {
        console.warn("[client] failed to persist selection", err);
      });
    }, SELECTION_DEBOUNCE_MS);
  }

  // ---- Apply a server view into local state ----
  function applyView(view: import("./lib/api").ProjectView) {
    const patch = hydrateFromView(view);
    store.set(patch);
    promptInput.value = view.spritePrompt;
    motionInput.value = view.motionPrompt;
  }

  // ---- Render reactivity ----
  store.subscribe((state) => {
    const busy =
      state.status === "generating-image" ||
      state.status === "generating-video" ||
      state.status === "extracting-frames";

    generateSpriteBtn.disabled = busy;
    generateFramesBtn.disabled = busy || !state.spriteSrc;
    generateSheetBtn.disabled = busy || state.frames.length === 0;
    exportBtn.disabled = !state.spritesheetSrc;

    if (state.spriteSrc) {
      spritePreview.innerHTML = `<img src="${state.spriteSrc}" alt="Reference sprite" />`;
      if (state.spriteDimensions) {
        spriteCaption.textContent = `${state.spriteDimensions.w} × ${state.spriteDimensions.h} px`;
      } else {
        spriteCaption.textContent = "—";
      }
    } else if (!busy) {
      spritePreview.innerHTML = `<span class="preview__placeholder">No sprite yet</span>`;
      spriteCaption.textContent = "—";
    }

    framesGrid.innerHTML = renderFramesGrid(state.frames, state.selectedFrameIndices);

    if (state.spritesheetSrc && state.spritesheetCols) {
      sheetPreview.innerHTML = `<img src="${state.spritesheetSrc}" alt="Spritesheet" />`;
      sheetMeta.textContent = `1 × ${state.spritesheetCols} · ${state.spritesheetCols} frames`;
    } else {
      sheetPreview.innerHTML = `<span class="sheet-preview__placeholder">Generate a spritesheet to preview here</span>`;
      const pending = state.selectedFrameIndices.size;
      sheetMeta.textContent = pending > 0 ? `1 × ${pending} · pending` : "No spritesheet yet";
    }

    if (state.previewGifBuilding) {
      gifPreview.innerHTML = `<span class="gif-preview__placeholder">${spinner()}Building animated preview…</span>`;
    } else if (state.previewGifSrc) {
      gifPreview.innerHTML = `<img src="${state.previewGifSrc}" alt="Animated preview" />`;
    } else {
      gifPreview.innerHTML = `<span class="gif-preview__placeholder">Generate a spritesheet to see the animation</span>`;
    }

    projectLabel.textContent =
      state.currentProjectName === "latest" ? "untitled" : state.currentProjectName;

    loadMenu.innerHTML = renderLoadMenu(state.savedProjects);
  });

  // ---- Boot ----
  Promise.all([checkHealth(), getCurrentProject(), listProjects()])
    .then(([health, view, projects]) => {
      if (!health.hasApiKey) {
        setStatus(
          spriteStatus,
          "XAI_API_KEY is missing on the server. Add it to .env and restart.",
          "error",
        );
      }
      store.set({ savedProjects: projects });
      applyView(view);
    })
    .catch((err) => {
      console.error("[client] boot failed", err);
      setStatus(spriteStatus, "Backend not reachable.", "error");
    });
}

function spinner(): string {
  return `<span class="spinner"></span>`;
}

function setStatus(
  el: HTMLElement,
  html: string,
  kind: "info" | "error" | "success" = "info",
) {
  el.className =
    "status" +
    (kind === "error" ? " status--error" : kind === "success" ? " status--success" : "");
  el.innerHTML = html;
}

function renderFramesGrid(frames: string[], selected: Set<number>): string {
  const count = frames.length > 0 ? frames.length : EMPTY_PLACEHOLDER_SLOTS;
  const tiles: string[] = [];
  for (let i = 0; i < count; i++) {
    const frame = frames[i];
    const isSelected = selected.has(i);
    const empty = !frame;
    tiles.push(`
      <div class="frame-tile ${isSelected ? "is-selected" : ""} ${empty ? "is-empty" : ""}" data-index="${i}">
        <div class="frame-tile__num">${i + 1}</div>
        ${frame ? `<img src="${frame}" alt="Frame ${i + 1}" />` : ""}
      </div>
    `);
  }
  return tiles.join("");
}

function renderLoadMenu(projects: { name: string; updatedAt: string }[]): string {
  if (projects.length === 0) {
    return `<div class="load-menu__empty">No saved projects yet</div>`;
  }
  return projects
    .map((p) => {
      const when = new Date(p.updatedAt).toLocaleString();
      return `
        <div class="load-menu__row">
          <button class="load-menu__item" data-load-name="${escapeAttr(p.name)}">
            <span class="load-menu__name">${escapeHtml(p.name)}</span>
            <span class="load-menu__time">${escapeHtml(when)}</span>
          </button>
          <button class="load-menu__delete" data-delete-name="${escapeAttr(p.name)}" title="Delete">${trashIcon}</button>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function renderShell(): string {
  return `
    <div class="app">
      <header class="app-header">
        <div class="app-header__brand">
          <span class="app-header__logo">
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
          </span>
          <span class="app-header__title">Sprite Sheet Builder</span>
          <span class="app-header__project">· <span id="project-label">untitled</span></span>
        </div>

        <div class="app-header__actions">
          <button id="btn-new-project" class="btn btn--secondary btn--sm" type="button">
            ${plusIcon}
            New
          </button>
          <div class="load-menu-wrap">
            <button id="btn-load-project" class="btn btn--secondary btn--sm" type="button">
              ${folderIcon}
              Load
              ${chevronIcon}
            </button>
            <div id="load-menu" class="load-menu"></div>
          </div>
          <button id="btn-save-project" class="btn btn--secondary btn--sm" type="button">
            ${saveIcon}
            Save
          </button>
          <button class="app-header__help" type="button" aria-label="Help">?</button>
        </div>
      </header>

      <main class="app-main">
        <div class="columns">

          <section class="card">
            <h2 class="card__title">1. Generate Reference Sprite</h2>
            <div class="field">
              <label class="field__label" for="sprite-prompt">Reference Sprite Prompt</label>
              <textarea
                id="sprite-prompt"
                class="textarea"
                placeholder="Describe the character or object…"
                rows="3"
              ></textarea>
            </div>
            <button id="btn-generate-sprite" class="btn btn--primary btn--block" type="button">
              ${sparkleIcon}
              Generate Reference Sprite
            </button>
            <div id="sprite-status" class="status"></div>
            <div class="preview">
              <div class="preview__label">Reference Sprite</div>
              <div id="sprite-preview" class="preview__box">
                <span class="preview__placeholder">No sprite yet</span>
              </div>
              <div id="sprite-caption" class="preview__caption">—</div>
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">2. Generate Movement Frames</h2>
            <div class="field">
              <label class="field__label" for="motion-prompt">Movement Prompt</label>
              <textarea
                id="motion-prompt"
                class="textarea"
                placeholder="e.g., walking left, jump, attack right…"
                rows="3"
              ></textarea>
            </div>
            <button id="btn-generate-frames" class="btn btn--secondary" type="button">
              ${frameIcon}
              Generate Frames
            </button>
            <div id="frames-status" class="status"></div>
            <div class="frames-section">
              <div class="frames-section__label">Select frames to include</div>
              <div id="frames-grid" class="frames-grid"></div>
            </div>
            <button id="btn-generate-sheet" class="btn btn--primary btn--block btn--lg" type="button">
              ${gridIcon}
              Generate Spritesheet
            </button>
          </section>

          <section class="card">
            <h2 class="card__title">3. Spritesheet Preview</h2>
            <div id="sheet-preview" class="sheet-preview">
              <span class="sheet-preview__placeholder">Generate a spritesheet to preview here</span>
            </div>
            <div class="sheet-footer">
              <div id="sheet-meta" class="sheet-footer__meta">No spritesheet yet</div>
              <button id="btn-export" class="btn btn--secondary" type="button">
                ${downloadIcon}
                Export PNG
              </button>
            </div>
            <div class="gif-section">
              <div class="gif-section__label">Animated Preview</div>
              <div id="gif-preview" class="gif-preview">
                <span class="gif-preview__placeholder">Generate a spritesheet to see the animation</span>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  `;
}

function createToast(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "toast";
  root.appendChild(el);
  let timer: number | undefined;
  return (msg: string) => {
    el.textContent = msg;
    el.classList.add("is-visible");
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove("is-visible"), 2200);
  };
}
