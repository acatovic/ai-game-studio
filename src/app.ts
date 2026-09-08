import {
  changeSprite,
  saveDraft,
  animateSprite,
  checkHealth,
  deleteProject,
  generateSprite,
  setActiveProject,
  getImageModels,
  getVideoModels,
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
  const spriteModelSelect = root.querySelector<HTMLSelectElement>("#sprite-model")!;
  const generateSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sprite")!;
  const spritePreview = root.querySelector<HTMLDivElement>("#sprite-preview")!;
  const spriteCaption = root.querySelector<HTMLDivElement>("#sprite-caption")!;
  const spriteStatus = root.querySelector<HTMLDivElement>("#sprite-status")!;

  const motionInput = root.querySelector<HTMLTextAreaElement>("#motion-prompt")!;
  const motionModelSelect = root.querySelector<HTMLSelectElement>("#motion-model")!;
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

  const welcome = root.querySelector<HTMLElement>("#welcome")!;
  const editor = root.querySelector<HTMLElement>("#editor")!;
  const homeProjects = root.querySelector<HTMLElement>("#home-projects")!;
  const homeNew = root.querySelector<HTMLButtonElement>("#home-new")!;
  const homeOpen = root.querySelector<HTMLButtonElement>("#home-open")!;
  const closeBtn = root.querySelector<HTMLButtonElement>("#btn-close-project")!;
  homeNew.addEventListener("click", () => newBtn.click());
  homeOpen.addEventListener("click", async () => {
    homeProjects.hidden = !homeProjects.hidden;
    if (!homeProjects.hidden) {
      try { store.set({ savedProjects: await listProjects() }); }
      catch (err) { toast(err instanceof Error ? err.message : "Could not open projects"); }
    }
  });
  closeBtn.addEventListener("click", async () => {
    store.set({ navigating: true });
    try {
      await persistDraft();
      setActiveProject(null);
      const state = store.get();
      store.set({ ...createInitialState(), imageModels: state.imageModels, videoModels: state.videoModels,
        savedProjects: await listProjects() });
    } catch (err) { toast(err instanceof Error ? err.message : "Could not close project"); }
    finally { store.set({ navigating: false }); }
  });

  // ---- Event handlers ----
  promptInput.addEventListener("input", () => {
    store.set({ spritePrompt: promptInput.value });
  });

  spriteModelSelect.addEventListener("change", () => {
    store.set({ spriteModel: spriteModelSelect.value });
  });

  motionInput.addEventListener("input", () => {
    store.set({ motionPrompt: motionInput.value });
  });

  motionModelSelect.addEventListener("change", () => {
    store.set({ motionModel: motionModelSelect.value });
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
      const result = await generateSprite(prompt, store.get().spriteModel);
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
      const view = await animateSprite(state.spriteSrc, text, state.motionModel);
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
    store.set({ previewGifBuilding: true });
    setStatus(framesStatus, `${spinner()}Composing spritesheet…`);
    try {
      await persistDraft();
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
      store.set({ previewGifBuilding: false });
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
    const name = window.prompt("New project name (letters, numbers, hyphen or underscore):");
    if (!name?.trim()) return;
    store.set({ navigating: true });
    try {
      await persistBeforeNavigation();
      const view = await newProject(name.trim());
      applyView(view);
      setStatus(spriteStatus, "", "info");
      setStatus(framesStatus, "", "info");
      store.set({ savedProjects: await listProjects() });
      toast("Started a new project");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start new project";
      toast(message);
    } finally { store.set({ navigating: false }); }
  });

  saveBtn.addEventListener("click", async () => {
    const name = store.get().currentProjectName;
    store.set({ navigating: true });
    try {
      await persistDraft();
      const view = await saveProject();
      store.set({
        project: view.project,
        currentProjectName: view.name,
        savedProjects: await listProjects(),
      });
      toast(`Saved '${name}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast(message);
    } finally { store.set({ navigating: false }); }
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

  const handleProjectClick = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-load-name]");
    const del = target.closest<HTMLElement>("[data-delete-name]");

    if (del) {
      e.stopPropagation();
      const name = del.dataset.deleteName!;
      if (!window.confirm(`Delete saved project '${name}'? This can't be undone.`)) return;
      try {
        if (store.get().currentProjectName === name) {
          toast("Close this project before deleting it.");
          return;
        }
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
      store.set({ navigating: true });
      try {
        await persistBeforeNavigation();
        const view = await loadProject(name);
        applyView(view);
        toast(`Loaded '${name}'`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Load failed";
        toast(message);
      } finally { store.set({ navigating: false }); }
    }
  };
  loadMenu.addEventListener("click", handleProjectClick);
  homeProjects.addEventListener("click", handleProjectClick);

  const spritePicker = root.querySelector<HTMLSelectElement>("#sprite-picker")!;
  const addSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-add-sprite")!;
  const renameSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-rename-sprite")!;
  async function navigateSprite(action: "new" | "load" | "rename", value: string) {
    store.set({ navigating: true });
    try {
      await persistDraft();
      applyView(await changeSprite(action, value));
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update sprite"); }
    finally { store.set({ navigating: false }); }
  }
  spritePicker.addEventListener("change", () => { void navigateSprite("load", spritePicker.value); });
  addSpriteBtn.addEventListener("click", () => {
    const name = window.prompt("Sprite name:", `Sprite ${(store.get().project?.sprites.length ?? 0) + 1}`);
    if (name?.trim()) void navigateSprite("new", name.trim());
  });
  renameSpriteBtn.addEventListener("click", () => {
    const project = store.get().project;
    const name = window.prompt("Sprite name:", project?.sprites.find(s => s.id === project.activeSpriteId)?.name);
    if (name?.trim()) void navigateSprite("rename", name.trim());
  });
  async function persistDraft() {
    window.clearTimeout(selectionTimer);
    await selectionPending;
    const state = store.get();
    await saveSelection([...state.selectedFrameIndices]);
    await saveDraft({ spritePrompt: state.spritePrompt, motionPrompt: state.motionPrompt,
      spriteModel: state.spriteModel, motionModel: state.motionModel });
  }
  async function persistBeforeNavigation() {
    if (store.get().project) await persistDraft();
  }

  // ---- Debounced selection persistence ----
  let selectionPending: Promise<unknown> = Promise.resolve();
  let selectionTimer: number | undefined;
  function scheduleSelectionPersist() {
    if (selectionTimer) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const indices = [...store.get().selectedFrameIndices].sort((a, b) => a - b);
      selectionPending = saveSelection(indices).catch((err) => {
        console.warn("[client] failed to persist selection", err);
      });
    }, SELECTION_DEBOUNCE_MS);
  }

  // ---- Apply a server view into local state ----
  function applyView(view: import("./lib/api").ProjectView) {
    setStatus(spriteStatus, "");
    setStatus(framesStatus, "");
    setActiveProject(view);
    const patch = { ...hydrateFromView(view), status: "idle" as const, errorMessage: null };
    store.set(patch);
    promptInput.value = view.spritePrompt;
    motionInput.value = view.motionPrompt;
  }

  let lastImageModelOptionsKey = "";
  let lastVideoModelOptionsKey = "";

  // ---- Render reactivity ----
  store.subscribe((state) => {
    const busy =
      state.navigating || state.previewGifBuilding ||
      state.status === "generating-image" ||
      state.status === "generating-video" ||
      state.status === "extracting-frames";

    welcome.hidden = !!state.project;
    editor.hidden = !state.project;
    for (const button of [homeNew, homeOpen, closeBtn, newBtn, saveBtn, loadBtn, addSpriteBtn, renameSpriteBtn]) button.disabled = busy;
    spritePicker.disabled = busy;
    promptInput.disabled = busy;
    motionInput.disabled = busy;
    motionModelSelect.disabled = busy;
    loadMenu.inert = busy;
    framesGrid.inert = busy;
    const project = state.project;
    spritePicker.innerHTML = (project?.sprites ?? [{ id: "sprite-1", name: "Sprite 1" }])
      .map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join("");
    spritePicker.value = project?.activeSpriteId ?? "sprite-1";
    generateSpriteBtn.disabled = busy;
    spriteModelSelect.disabled = busy;
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

    projectLabel.textContent = state.currentProjectName;

    loadMenu.innerHTML = renderLoadMenu(state.savedProjects);
    homeProjects.innerHTML = renderLoadMenu(state.savedProjects);

    // Re-render the model select only when the list changes (avoid clobbering user input mid-edit)
    const imageOptionsKey = state.imageModels.map((m) => `${m.id}|${m.label}`).join(",");
    if (imageOptionsKey !== lastImageModelOptionsKey) {
      spriteModelSelect.innerHTML = state.imageModels
        .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.label)}</option>`)
        .join("");
      lastImageModelOptionsKey = imageOptionsKey;
    }
    if (spriteModelSelect.value !== state.spriteModel) {
      spriteModelSelect.value = state.spriteModel;
    }

    const videoOptionsKey = state.videoModels.map((m) => `${m.id}|${m.label}`).join(",");
    if (videoOptionsKey !== lastVideoModelOptionsKey) {
      motionModelSelect.innerHTML = state.videoModels
        .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.label)}</option>`)
        .join("");
      lastVideoModelOptionsKey = videoOptionsKey;
    }
    if (motionModelSelect.value !== state.motionModel) {
      motionModelSelect.value = state.motionModel;
    }
  });

  // ---- Boot ----
  Promise.all([
    checkHealth(),
    listProjects(),
    getImageModels(),
    getVideoModels(),
  ])
    .then(([health, projects, imageModelsResp, videoModelsResp]) => {
      if (!health.hasApiKey) {
        toast("OPENROUTER_API_KEY is missing. Add it to .env before generating assets.");
        setStatus(
          spriteStatus,
          "OPENROUTER_API_KEY is missing on the server. Add it to .env and restart.",
          "error",
        );
      }
      store.set({
        savedProjects: projects,
        imageModels: [...imageModelsResp.models],
        videoModels: [...videoModelsResp.models],
      });
    })
    .catch((err) => {
      console.error("[client] boot failed", err);
      toast("Backend not reachable. Start the server and refresh to try again.");
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
    <section id="welcome" class="welcome">
      <div class="welcome__content">
        <span class="welcome__eyebrow">AI Game Studio</span>
        <h1>Bring your next game to life.</h1>
        <p>Create a project to keep your sprites and animations together.</p>
        <div class="welcome__actions">
          <button id="home-new" class="btn btn--primary" type="button">${plusIcon} New Project</button>
          <button id="home-open" class="btn btn--secondary" type="button">${folderIcon} Open</button>
        </div>
        <div id="home-projects" class="welcome__projects" aria-label="Saved projects" hidden></div>
      </div>
    </section>
    <div id="editor" class="app" hidden>
      <header class="app-header">
        <div class="app-header__brand">
          <span class="app-header__logo">
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
          </span>
          <span class="app-header__title">Sprite Sheet Builder</span>
          <span class="app-header__project">· <span id="project-label"></span></span>
        </div>

        <div class="app-header__actions">
          <button id="btn-new-project" class="btn btn--secondary btn--sm" type="button">
            ${plusIcon}
            New project
          </button>
          <div class="load-menu-wrap">
            <button id="btn-load-project" class="btn btn--secondary btn--sm" type="button">
              ${folderIcon}
              Open
              ${chevronIcon}
            </button>
            <div id="load-menu" class="load-menu"></div>
          </div>
          <button id="btn-save-project" class="btn btn--secondary btn--sm" type="button">
            ${saveIcon}
            Save project
          </button>
          <button id="btn-close-project" class="btn btn--secondary btn--sm" type="button">Close project</button>
        </div>
      </header>

      <main class="app-main">
        <nav class="sprite-toolbar" aria-label="Project sprites">
          <label for="sprite-picker">Sprites</label>
          <select id="sprite-picker" class="select"></select>
          <button id="btn-rename-sprite" class="btn btn--secondary btn--sm" type="button">Rename</button>
          <button id="btn-add-sprite" class="btn btn--secondary btn--sm" type="button">${plusIcon} Add sprite</button>
          <span>Each sprite has its own frames and spritesheet</span>
        </nav>
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
            <div class="field">
              <label class="field__label" for="sprite-model">Model</label>
              <select id="sprite-model" class="select"></select>
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
            <div class="motion-controls">
              <div class="field motion-controls__model">
                <label class="field__label" for="motion-model">Model</label>
                <select id="motion-model" class="select"></select>
              </div>
              <button id="btn-generate-frames" class="btn btn--secondary motion-controls__btn" type="button">
                ${frameIcon}
                Generate Frames
              </button>
            </div>
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
