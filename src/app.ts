import {
  changeSprite,
  changeAnimation,
  saveDraft,
  animateSprite,
  checkHealth,
  deleteProject,
  deleteSprite,
  deleteAnimation,
  generateSprite,
  setReferenceImage,
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
import { mountMusic } from "./components/music";
import { confirmDelete } from "./components/confirm-delete";
import { mountPreviewBackground } from "./components/preview-background";
import { Store, createInitialState, hydrateFromView } from "./lib/state";
import { composeSpritesheet } from "./lib/spritesheet";
import { REFERENCE_VIEWS, REFERENCE_LABELS, sourceKey, type ImageSourceOption } from "./lib/character";
import { videoFrameError } from "./lib/video-capabilities";
import { REFERENCE_IMAGE_ACCEPT, isReferenceImageFile, readReferenceImage } from "./lib/reference-image";
import {
  chevronIcon,
  copyIcon,
  clipboardIcon,
  folderIcon,
  frameIcon,
  gridIcon,
  plusIcon,
  saveIcon,
  sparkleIcon,
  trashIcon,
  paperclipIcon,
  closeIcon,
} from "./components/icons";

const EMPTY_PLACEHOLDER_SLOTS = 8;
const SELECTION_DEBOUNCE_MS = 700;

export function mountApp(root: HTMLElement) {
  const store = new Store(createInitialState());
  root.innerHTML = renderShell();

  const toast = createToast(root);
  const music = mountMusic(root.querySelector<HTMLElement>("#music-workspace")!,
    busy => store.set({ navigating: busy }), askName);
  let workspace: "sprites" | "music" = "sprites";
  const spriteTab = root.querySelector<HTMLButtonElement>("#tab-sprites")!;
  const musicTab = root.querySelector<HTMLButtonElement>("#tab-music")!;
  for (const [tab, next] of [[spriteTab, "sprites"], [musicTab, "music"]] as const) {
    tab.addEventListener("click", async () => {
      store.set({ navigating: true });
      try {
        await persistDraft();
        music.stopPlayback();
        workspace = next;
      } catch (err) { toast(err instanceof Error ? err.message : "Could not save drafts"); }
      finally { store.set({ navigating: false }); }
    });
  }

  // ---- Refs ----
  const promptInput = root.querySelector<HTMLTextAreaElement>("#sprite-prompt")!;
  const referenceInput = root.querySelector<HTMLInputElement>("#reference-image-input")!;
  const attachReferenceBtn = root.querySelector<HTMLButtonElement>("#btn-attach-reference")!;
  const removeReferenceBtn = root.querySelector<HTMLButtonElement>("#btn-remove-reference")!;
  const attachedReference = root.querySelector<HTMLElement>("#attached-reference")!;
  const attachedReferenceImage = root.querySelector<HTMLImageElement>("#attached-reference-image")!;
  const attachedReferenceName = root.querySelector<HTMLElement>("#attached-reference-name")!;
  const spriteModelSelect = root.querySelector<HTMLSelectElement>("#sprite-model")!;
  const generateSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sprite")!;
  const spritePreview = root.querySelector<HTMLDivElement>("#sprite-preview")!;
  const spriteCaption = root.querySelector<HTMLDivElement>("#sprite-caption")!;
  const spriteStatus = root.querySelector<HTMLDivElement>("#sprite-status")!;
  const referenceTabs = root.querySelector<HTMLElement>("#reference-tabs")!;
  for (const view of REFERENCE_VIEWS) {
    root.querySelector<HTMLButtonElement>(`#reference-tab-${view}`)!.addEventListener("click", () => {
      store.set({ referenceView: view });
    });
  }
  referenceTabs.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const views = REFERENCE_VIEWS.filter(view => !!store.get().referenceViews[view]);
    if (!views.length) return;
    const index = views.indexOf(store.get().referenceView);
    const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    root.querySelector<HTMLButtonElement>(`#reference-tab-${views[next]}`)!.click();
    root.querySelector<HTMLButtonElement>(`#reference-tab-${views[next]}`)!.focus();
  });
  const endpointHint = root.querySelector<HTMLElement>("#endpoint-hint")!;
  const endpointSelects = {
    startImage: root.querySelector<HTMLSelectElement>("#start-image")!,
    endImage: root.querySelector<HTMLSelectElement>("#end-image")!,
  };
  for (const key of ["startImage", "endImage"] as const) {
    endpointSelects[key].addEventListener("change", () => {
      const state = store.get();
      const value = endpointSelects[key].value;
      const selected = [...state.imageSources, ...(state[key] ? [state[key]] : [])]
        .find(option => sourceKey(option.source) === value) ?? null;
      store.set({ [key]: selected });
    });
  }

  const motionInput = root.querySelector<HTMLTextAreaElement>("#motion-prompt")!;
  const copyCharacterPromptBtn = root.querySelector<HTMLButtonElement>("#btn-copy-character-prompt")!;
  const copyMotionPromptBtn = root.querySelector<HTMLButtonElement>("#btn-copy-motion-prompt")!;
  for (const [button, input] of [[copyCharacterPromptBtn, promptInput], [copyMotionPromptBtn, motionInput]] as const) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        toast("Prompt copied");
      } catch {
        toast("Could not copy prompt to clipboard.");
      }
    });
  }
  const motionModelSelect = root.querySelector<HTMLSelectElement>("#motion-model")!;
  const generateFramesBtn = root.querySelector<HTMLButtonElement>("#btn-generate-frames")!;
  const framesGrid = root.querySelector<HTMLDivElement>("#frames-grid")!;
  const framesStatus = root.querySelector<HTMLDivElement>("#frames-status")!;
  const generateSheetBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sheet")!;

  const sheetPreview = root.querySelector<HTMLDivElement>("#sheet-preview")!;
  const sheetMeta = root.querySelector<HTMLDivElement>("#sheet-meta")!;
  const gifPreview = root.querySelector<HTMLDivElement>("#gif-preview")!;
  mountPreviewBackground(root.querySelector<HTMLElement>("#preview-background")!, [sheetPreview, gifPreview]);

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
      await music.openProject(null);
      workspace = "sprites";
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

  async function attachReference(file: File | null) {
    if (attachReferenceBtn.disabled) return;
    store.set({ referenceImageLoading: true });
    try {
      const image = file ? await readReferenceImage(file) : null;
      if (file && !image) return;
      await persistDraft();
      const result = await setReferenceImage(image);
      store.set({ referenceImage: result.referenceImage });
    } catch (err) {
      setStatus(spriteStatus, err instanceof Error ? err.message : "Could not attach reference image.", "error");
    } finally {
      referenceInput.value = "";
      store.set({ referenceImageLoading: false });
    }
  }
  attachReferenceBtn.addEventListener("click", () => referenceInput.click());
  removeReferenceBtn.addEventListener("click", () => { void attachReference(null); });
  referenceInput.addEventListener("change", () => {
    const file = referenceInput.files?.[0];
    if (file) void attachReference(file);
  });
  root.querySelector<HTMLElement>("#character-prompt-field")!.addEventListener("paste", event => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = Array.from(clipboard.files);
    // Suppress file pastes even when unsupported; ordinary prompt text still pastes normally.
    if (!files.length && !Array.from(clipboard.items).some(item => item.kind === "file")) return;
    event.preventDefault();
    const file = files.find(isReferenceImageFile);
    if (file) void attachReference(file);
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
    setStatus(spriteStatus, `${spinner()}Generating and aligning side, front and back views…`);
    try {
      await persistDraft();
      const result = await generateSprite(prompt, store.get().spriteModel);
      await applyView(result.view);
      store.set({ spriteSrc: result.dataUrl, referenceView: "side" });
      setStatus(spriteStatus, "Three aligned reference views ready.", "success");
      toast("Character views generated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate sprite";
      store.set({ status: "error", errorMessage: message });
      setStatus(spriteStatus, message, "error");
    }
  });

  generateFramesBtn.addEventListener("click", async () => {
    const state = store.get();
    if (!state.spriteSrc && !state.startImage) {
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
      await persistDraft();
      const view = await animateSprite(state.spriteSrc, text, state.motionModel,
        { startImage: state.startImage?.source ?? null, endImage: state.endImage?.source ?? null });
      await applyView(view);
      await saveCurrentAnimation();
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

  async function saveCurrentAnimation() {
    const state = store.get();
    const selected = [...state.selectedFrameIndices].sort((a, b) => a - b)
      .map(i => state.frames[i]).filter(Boolean);
    if (!selected.length) throw new Error("Select at least one frame to include.");
    store.set({ previewGifBuilding: true });
    setStatus(framesStatus, `${spinner()}Saving PNG and Aseprite…`);
    try {
      await persistDraft();
      const sheet = await composeSpritesheet({ frameSrcs: selected });
      const view = await saveSpritesheet(sheet.dataUrl);
      await applyView(view);
      setStatus(framesStatus, view.previewGifUrl
        ? "PNG, Aseprite and animated preview saved."
        : "PNG and Aseprite saved. Animated preview could not be built.", "success");
    } finally {
      store.set({ previewGifBuilding: false });
    }
  }

  generateSheetBtn.addEventListener("click", async () => {
    try { await saveCurrentAnimation(); }
    catch (err) { setStatus(framesStatus, err instanceof Error ? err.message : "Could not save animation", "error"); }
  });

  // ---- New / Save / Load wiring ----
  newBtn.addEventListener("click", async () => {
    const name = await askName("New project", "", 40);
    if (!name?.trim()) return;
    store.set({ navigating: true });
    try {
      await persistBeforeNavigation();
      const view = await newProject(name.trim());
      await applyView(view);
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
        await applyView(view);
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
  const deleteSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-delete-sprite")!;
  async function navigateSprite(action: "new" | "load" | "rename", value: string) {
    store.set({ navigating: true });
    try {
      await persistDraft();
      await applyView(await changeSprite(action, value));
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update sprite"); }
    finally { store.set({ navigating: false }); }
  }
  spritePicker.addEventListener("change", () => { void navigateSprite("load", spritePicker.value); });
  addSpriteBtn.addEventListener("click", async () => {
    const name = await askName("Add character");
    if (name?.trim()) void navigateSprite("new", name.trim());
  });
  renameSpriteBtn.addEventListener("click", async () => {
    const project = store.get().project;
    const name = await askName("Rename character", project?.sprites.find(s => s.id === project.activeSpriteId)?.name);
    if (name?.trim()) void navigateSprite("rename", name.trim());
  });
  deleteSpriteBtn.addEventListener("click", async () => {
    if (deleteSpriteBtn.disabled) return;
    const project = store.get().project;
    const character = project?.sprites.find(sprite => sprite.id === project.activeSpriteId);
    if (!character) return;
    store.set({ navigating: true });
    try {
      if (!await confirmDelete("character", character.name)) return;
      await persistDraft();
      await applyView(await deleteSprite());
      toast(`Deleted character '${character.name}'`);
    } catch (err) { toast(err instanceof Error ? err.message : "Could not delete character"); }
    finally { store.set({ navigating: false }); }
  });
  const animationPicker = root.querySelector<HTMLSelectElement>("#animation-picker")!;
  const addAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-add-animation")!;
  const renameAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-rename-animation")!;
  const duplicateAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-duplicate-animation")!;
  const deleteAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-delete-animation")!;
  async function navigateAnimation(action: "new" | "load" | "rename" | "duplicate", value: string) {
    store.set({ navigating: true });
    try {
      await persistDraft();
      await applyView(await changeAnimation(action, value));
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update animation"); }
    finally { store.set({ navigating: false }); }
  }
  animationPicker.addEventListener("change", () => { void navigateAnimation("load", animationPicker.value); });
  addAnimationBtn.addEventListener("click", async () => {
    const name = await askName("Add animation");
    if (name?.trim()) void navigateAnimation("new", name.trim());
  });
  renameAnimationBtn.addEventListener("click", async () => {
    const state = store.get();
    const name = await askName("Rename animation", state.animations.find(a => a.id === state.activeAnimationId)?.name);
    if (name?.trim()) void navigateAnimation("rename", name.trim());
  });
  duplicateAnimationBtn.addEventListener("click", async () => {
    const state = store.get();
    const current = state.animations.find(a => a.id === state.activeAnimationId);
    if (!current) return;
    const base = current.name.replace(/-\d+$/, "");
    const names = new Set(state.animations.map(a => a.name.toLowerCase()));
    let suffix = 2;
    let suggestion: string;
    do {
      const ending = `-${suffix++}`;
      suggestion = `${base.slice(0, 60 - ending.length)}${ending}`;
    } while (names.has(suggestion.toLowerCase()));
    const name = await askName("Duplicate animation", suggestion);
    if (name?.trim()) void navigateAnimation("duplicate", name.trim());
  });
  deleteAnimationBtn.addEventListener("click", async () => {
    if (deleteAnimationBtn.disabled) return;
    const state = store.get();
    const animation = state.animations.find(a => a.id === state.activeAnimationId);
    if (!animation) return;
    store.set({ navigating: true });
    try {
      if (!await confirmDelete("animation", animation.name)) return;
      await persistDraft();
      await applyView(await deleteAnimation());
      toast(`Deleted animation '${animation.name}'`);
    } catch (err) { toast(err instanceof Error ? err.message : "Could not delete animation"); }
    finally { store.set({ navigating: false }); }
  });
  async function persistDraft() {
    window.clearTimeout(selectionTimer);
    await selectionPending;
    await music.persist();
    const state = store.get();
    if (!state.project?.activeSpriteId) return;
    if (state.activeAnimationId) await saveSelection([...state.selectedFrameIndices]);
    await saveDraft({ spritePrompt: state.spritePrompt, motionPrompt: state.motionPrompt,
      spriteModel: state.spriteModel, motionModel: state.motionModel,
      startImage: state.startImage?.source ?? null, endImage: state.endImage?.source ?? null });
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
  async function applyView(view: import("./lib/api").ProjectView) {
    const sameCharacter = store.get().project?.activeSpriteId === view.project.activeSpriteId
      && store.get().currentProjectName === view.name;
    setStatus(spriteStatus, "");
    setStatus(framesStatus, "");
    setActiveProject(view);
    await music.openProject(view.name);
    const patch = { ...hydrateFromView(view), status: "idle" as const, errorMessage: null };
    store.set({ ...patch, referenceView: sameCharacter && patch.referenceViews?.[store.get().referenceView]
      ? store.get().referenceView : "side" });
    promptInput.value = view.spritePrompt;
    motionInput.value = view.motionPrompt;
  }

  let lastImageModelOptionsKey = "";
  let lastVideoModelOptionsKey = "";

  // ---- Render reactivity ----
  store.subscribe((state) => {
    const busy =
      state.navigating || state.previewGifBuilding || state.referenceImageLoading ||
      state.status === "generating-image" ||
      state.status === "generating-video" ||
      state.status === "extracting-frames";

    music.setBusy(busy);
    spriteTab.disabled = musicTab.disabled = busy;
    spriteTab.setAttribute("aria-pressed", String(workspace === "sprites"));
    musicTab.setAttribute("aria-pressed", String(workspace === "music"));
    root.querySelector<HTMLElement>("#sprites-workspace")!.hidden = workspace !== "sprites";
    root.querySelector<HTMLElement>("#music-workspace")!.hidden = workspace !== "music";
    welcome.hidden = !!state.project;
    editor.hidden = !state.project;
    for (const button of [homeNew, homeOpen, closeBtn, newBtn, saveBtn, loadBtn, addSpriteBtn, renameSpriteBtn, addAnimationBtn, renameAnimationBtn]) button.disabled = busy;
    const hasCharacter = !!state.project?.activeSpriteId;
    const hasAnimation = !!state.activeAnimationId;
    root.querySelector<HTMLElement>(".columns")!.hidden = !hasCharacter;
    spritePicker.hidden = !hasCharacter;
    root.querySelector<HTMLElement>('label[for="sprite-picker"]')!.hidden = !hasCharacter;
    renameSpriteBtn.hidden = !hasCharacter;
    deleteSpriteBtn.hidden = !hasCharacter;
    deleteSpriteBtn.disabled = busy || !hasCharacter;
    root.querySelector<HTMLElement>(".sprite-toolbar > span")!.hidden = !hasCharacter;
    animationPicker.hidden = !hasAnimation;
    renameAnimationBtn.hidden = !hasAnimation;
    duplicateAnimationBtn.hidden = !hasAnimation;
    duplicateAnimationBtn.disabled = busy || !hasAnimation;
    deleteAnimationBtn.hidden = !hasAnimation;
    deleteAnimationBtn.disabled = busy || !hasAnimation;
    root.querySelector<HTMLElement>('label[for="animation-picker"]')!.hidden = !hasAnimation;
    root.querySelector<HTMLElement>("#animation-fields")!.hidden = !hasAnimation;
    spritePicker.disabled = busy || !hasCharacter;
    animationPicker.disabled = busy || !hasAnimation;
    addAnimationBtn.disabled = busy || !hasCharacter;
    animationPicker.innerHTML = state.animations.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.name)}</option>`).join("");
    animationPicker.value = state.activeAnimationId;
    promptInput.disabled = busy || !hasCharacter;
    copyCharacterPromptBtn.disabled = !hasCharacter || !state.spritePrompt.trim();
    copyMotionPromptBtn.disabled = !hasAnimation || !state.motionPrompt.trim();
    attachReferenceBtn.disabled = referenceInput.disabled = removeReferenceBtn.disabled = busy || !hasCharacter;
    attachReferenceBtn.innerHTML = state.referenceImageLoading ? spinner() : paperclipIcon;
    attachReferenceBtn.setAttribute("aria-busy", String(state.referenceImageLoading));
    attachReferenceBtn.setAttribute("aria-label", state.referenceImage ? "Replace reference image" : "Attach reference image");
    attachedReference.hidden = !state.referenceImage;
    if (state.referenceImage) {
      if (attachedReferenceImage.getAttribute("src") !== state.referenceImage.url) attachedReferenceImage.src = state.referenceImage.url;
      attachedReferenceImage.alt = state.referenceImage.name;
      attachedReferenceName.textContent = state.referenceImage.name;
      attachedReference.title = state.referenceImage.name;
    } else {
      attachedReferenceImage.removeAttribute("src");
      attachedReferenceName.textContent = "";
    }
    motionInput.disabled = busy || !hasAnimation;
    motionModelSelect.disabled = busy || !hasAnimation;
    loadMenu.inert = busy;
    framesGrid.inert = busy;
    const project = state.project;
    spritePicker.innerHTML = (project?.sprites ?? [])
      .map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join("");
    spritePicker.value = project?.activeSpriteId ?? "";
    generateSpriteBtn.disabled = busy || !hasCharacter;
    spriteModelSelect.disabled = busy || !hasCharacter;
    const videoModel = state.videoModels.find(model => model.id === state.motionModel);
    const frameError = videoModel ? videoFrameError(videoModel, !!state.startImage, !!state.endImage) : null;
    generateFramesBtn.disabled = busy || !hasAnimation || (!state.spriteSrc && !state.startImage) || !!frameError;
    generateSheetBtn.disabled = busy || state.selectedFrameIndices.size === 0;


    for (const view of REFERENCE_VIEWS) {
      const tab = root.querySelector<HTMLButtonElement>(`#reference-tab-${view}`)!;
      tab.disabled = busy || !state.referenceViews[view];
      tab.setAttribute("aria-selected", String(state.referenceView === view));
      tab.tabIndex = state.referenceView === view ? 0 : -1;
      tab.title = state.referenceViews[view] ? `${REFERENCE_LABELS[view]} view` : "Generate Character to create all three views";
    }
    spritePreview.setAttribute("aria-labelledby", `reference-tab-${state.referenceView}`);
    const referenceSrc = state.referenceViews[state.referenceView] ?? (state.referenceView === "side" ? state.spriteSrc : null);
    if (referenceSrc) {
      spritePreview.innerHTML = `<img src="${escapeAttr(referenceSrc)}" alt="${REFERENCE_LABELS[state.referenceView]} character reference" />`;
      if (state.spriteDimensions) {
        spriteCaption.textContent = `${REFERENCE_LABELS[state.referenceView]} · ${state.spriteDimensions.w} × ${state.spriteDimensions.h} px` +
          (state.referenceAlignment ? " · Aligned height & center" : " · Generate to add aligned views");
      } else {
        spriteCaption.textContent = "—";
      }
    } else if (!busy) {
      spritePreview.innerHTML = `<span class="preview__placeholder">No sprite yet</span>`;
      spriteCaption.textContent = "—";
    }

    for (const key of ["startImage", "endImage"] as const) {
      const select = endpointSelects[key];
      const selected = state[key];
      select.innerHTML = renderImageSourceOptions(state.imageSources, selected, "None");
      select.value = sourceKey(selected?.source ?? null);
      select.disabled = busy || !hasAnimation;
      const preview = root.querySelector<HTMLElement>(`#${key === "startImage" ? "start" : "end"}-image-preview`)!;
      const image = selected?.url;
      preview.innerHTML = image
        ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(selected?.label ?? "Side reference")}" />`
        : `<span>${key === "startImage" ? "No start frame" : "Loop"}</span>`;
    }
    endpointHint.textContent = frameError ?? (state.endImage ? (state.startImage
        ? "Transition between these poses. Selected images are saved with this animation."
        : "Finish at the selected end pose with no fixed start frame.")
      : !state.startImage ? (state.motionModel === "minimax/hailuo-3-max"
        ? "No fixed start frame. H3 Max uses the character and movement prompts."
        : "No fixed start frame. The character reference guides appearance.")
      : "Optional: choose a reference or a sequence’s first/last included frame. Poses are saved with this animation.");
    endpointHint.classList.toggle("status--error", !!frameError);

    framesGrid.innerHTML = renderFramesGrid(state.frames, state.selectedFrameIndices);

    if (state.spritesheetSrc && state.spritesheetCols) {
      sheetPreview.innerHTML = `<img src="${state.spritesheetSrc}" alt="Spritesheet" />`;
      const animationName = state.animations.find(a => a.id === state.activeAnimationId)?.name ?? "animation";
      sheetMeta.textContent = `${animationName}.png${state.asepriteSrc ? ` + ${animationName}.aseprite` : " (regenerate to save Aseprite)"} · ${state.spritesheetCols} frames`;
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
        toast("OPENROUTER_API_KEY is missing. Add it to .env to generate characters and animations.");
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

function renderImageSourceOptions(options: ImageSourceOption[], selected: ImageSourceOption | null, empty: string): string {
  const option = (item: ImageSourceOption) =>
    `<option value="${escapeAttr(sourceKey(item.source))}">${escapeHtml(item.label)}</option>`;
  const references = options.filter(item => item.source.kind === "reference");
  const frames = options.filter(item => item.source.kind === "animation");
  return `<option value="">${escapeHtml(empty)}</option>` +
    (selected && !options.some(item => sourceKey(item.source) === sourceKey(selected.source))
      ? `<optgroup label="Saved pose">${option({ ...selected, label: `${selected.label} · saved` })}</optgroup>` : "") +
    (references.length ? `<optgroup label="Character references">${references.map(option).join("")}</optgroup>` : "") +
    (frames.length ? `<optgroup label="Animation frames">${frames.map(option).join("")}</optgroup>` : "");
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
        <p>Create a project to keep your characters, animations and sounds together.</p>
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
          <span class="app-header__title">AI Game Studio</span>
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
        <nav class="asset-tabs" aria-label="Asset type">
          <button id="tab-sprites" class="btn btn--secondary" type="button" aria-pressed="true">Characters & Animations</button>
          <button id="tab-music" class="btn btn--secondary" type="button" aria-pressed="false">Sound &amp; SFX</button>
        </nav>
        <div id="sprites-workspace">
        <nav class="sprite-toolbar" aria-label="Project characters">
          <label for="sprite-picker">Characters</label>
          <select id="sprite-picker" class="select"></select>
          <button id="btn-add-sprite" class="btn btn--secondary btn--sm" type="button">${plusIcon} Add character</button>
          <button id="btn-rename-sprite" class="btn btn--secondary btn--sm" type="button">Rename</button>
          <button id="btn-delete-sprite" class="btn btn--secondary btn--sm" type="button" title="Delete character" aria-label="Delete character">${trashIcon}</button>
          <span>Three reference views, connected animations</span>
        </nav>
        <div class="columns">

          <section class="card">
            <h2 class="card__title">1. Create Character</h2>
            <div id="character-prompt-field" class="field">
              <label class="field__label" for="sprite-prompt">Character Prompt</label>
              <textarea
                id="sprite-prompt"
                class="textarea"
                placeholder="Describe the character or object…"
                rows="3"
              ></textarea>
              <div class="reference-attachment">
                <input id="reference-image-input" type="file" accept="${REFERENCE_IMAGE_ACCEPT}" hidden />
                <button id="btn-attach-reference" class="reference-attachment__button" type="button" aria-label="Attach reference image">
                  ${paperclipIcon}
                </button>
                <button id="btn-copy-character-prompt" class="prompt-copy" type="button" title="Copy character prompt" aria-label="Copy character prompt">${clipboardIcon}</button>
                <div id="attached-reference" class="reference-attachment__preview" hidden>
                  <img id="attached-reference-image" alt="" />
                  <span id="attached-reference-name"></span>
                  <button id="btn-remove-reference" class="reference-attachment__button" type="button" aria-label="Remove reference image">${closeIcon}</button>
                </div>
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="sprite-model">Model</label>
              <select id="sprite-model" class="select"></select>
            </div>
            <button id="btn-generate-sprite" class="btn btn--primary btn--block" type="button">
              ${sparkleIcon}
              Generate Character
            </button>
            <div id="sprite-status" class="status"></div>
            <div class="preview">
              <div class="preview__label">Character Reference</div>
              <div id="reference-tabs" class="reference-tabs" role="tablist" aria-label="Character view">
                ${REFERENCE_VIEWS.map(view => `<button id="reference-tab-${view}" type="button" role="tab"
                  aria-controls="sprite-preview" aria-selected="${view === "side"}">${REFERENCE_LABELS[view]}</button>`).join("")}
              </div>
              <div id="sprite-preview" class="preview__box" role="tabpanel" aria-labelledby="reference-tab-side">
                <span class="preview__placeholder">No sprite yet</span>
              </div>
              <div id="sprite-caption" class="preview__caption">—</div>
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">2. Create Animation</h2>
            <div class="field">
              <label class="field__label" for="animation-picker">Animation</label>
              <select id="animation-picker" class="select"></select>
              <div class="animation-actions">
                <button id="btn-add-animation" class="btn btn--secondary btn--sm" type="button">${plusIcon} Add animation</button>
                <button id="btn-rename-animation" class="btn btn--secondary btn--sm" type="button">Rename</button>
                <button id="btn-delete-animation" class="btn btn--secondary btn--sm" type="button" title="Delete animation" aria-label="Delete animation">${trashIcon}</button>
                <button id="btn-duplicate-animation" class="btn btn--secondary btn--sm" type="button" title="Duplicate animation" aria-label="Duplicate animation">${copyIcon}</button>
              </div>
            </div>
            <div id="animation-fields">
            <div class="field">
              <label class="field__label" for="motion-prompt">Movement Prompt</label>
              <textarea
                id="motion-prompt"
                class="textarea"
                placeholder="e.g., walking left, jump, attack right…"
                rows="3"
              ></textarea>
              <div class="prompt-actions">
                <button id="btn-copy-motion-prompt" class="prompt-copy" type="button" title="Copy animation prompt" aria-label="Copy animation prompt">${clipboardIcon}</button>
              </div>
            </div>
            <div class="endpoint-images" role="group" aria-label="Animation start and end images">
              <div class="field">
                <label class="field__label" for="start-image">Start image <span class="field__optional">optional</span></label>
                <div id="start-image-preview" class="endpoint-preview"></div>
                <select id="start-image" class="select" aria-describedby="endpoint-hint"></select>
              </div>
              <div class="field">
                <label class="field__label" for="end-image">End image <span class="field__optional">optional</span></label>
                <div id="end-image-preview" class="endpoint-preview"></div>
                <select id="end-image" class="select" aria-describedby="endpoint-hint"></select>
              </div>
            </div>
            <p id="endpoint-hint" class="endpoint-hint" aria-live="polite"></p>
            <div class="motion-controls">
              <div class="field motion-controls__model">
                <label class="field__label" for="motion-model">Model</label>
                <select id="motion-model" class="select"></select>
              </div>
              <button id="btn-generate-frames" class="btn btn--secondary motion-controls__btn" type="button">
                ${frameIcon}
                Generate Animation
              </button>
            </div>
            <div id="frames-status" class="status"></div>
            <div class="frames-section">
              <div class="frames-section__label">Select frames to include</div>
              <div id="frames-grid" class="frames-grid"></div>
            </div>
            <button id="btn-generate-sheet" class="btn btn--primary btn--block btn--lg" type="button">
              ${gridIcon}
              Update Spritesheet
            </button>
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">3. Spritesheet Preview</h2>
            <div id="preview-background" class="preview-background"></div>
            <div id="sheet-preview" class="sheet-preview">
              <span class="sheet-preview__placeholder">Generate a spritesheet to preview here</span>
            </div>
            <div class="sheet-footer">
              <div id="sheet-meta" class="sheet-footer__meta">No spritesheet yet</div>
            </div>
            <p class="asset-save-note">PNG and Aseprite are saved automatically in your project. Update the spritesheet after changing the frame selection.</p>
            <div class="gif-section">
              <div class="gif-section__label">Animated Preview</div>
              <div id="gif-preview" class="gif-preview">
                <span class="gif-preview__placeholder">Generate a spritesheet to see the animation</span>
              </div>
            </div>
          </section>

        </div>
        </div>
        <div id="music-workspace" hidden></div>
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

function askName(title: string, initial = "", maxLength = 60): Promise<string | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "name-dialog";
  dialog.setAttribute("aria-labelledby", "name-dialog-title");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="name-dialog-title">${escapeHtml(title)}</h2>
    <label class="field__label" for="asset-name">Name</label>
    <input id="asset-name" class="select" name="name" value="${escapeAttr(initial)}"
      required maxlength="${maxLength}" pattern="[a-zA-Z0-9_\\-]+" autofocus autocomplete="off" />
    <p>Use letters, numbers, hyphens or underscores. This name is used for the folder.</p>
    <div class="name-dialog__actions">
      <button class="btn btn--secondary" value="cancel" formnovalidate>Cancel</button>
      <button class="btn btn--primary" value="save">Save name</button>
    </div>
  </form>`;
  document.body.appendChild(dialog);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue === "save" ? dialog.querySelector<HTMLInputElement>("input")!.value.trim() : null;
      dialog.remove();
      resolve(value);
    }, { once: true });
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")!.select();
  });
}
