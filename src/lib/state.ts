import type { ProjectSummary, ProjectView, VideoModelOption } from "./api";

export const DEFAULT_VIDEO_MODEL = "x-ai/grok-imagine-video";

export type AppStatus =
  | "idle"
  | "generating-image"
  | "generating-video"
  | "extracting-frames"
  | "done"
  | "error";

export interface AppState {
  status: AppStatus;
  errorMessage: string | null;
  spritePrompt: string;
  motionPrompt: string;
  motionModel: string;
  videoModels: VideoModelOption[];
  spriteSrc: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: Set<number>;
  spritesheetSrc: string | null;
  spritesheetCols: number | null;
  previewGifSrc: string | null;
  previewGifBuilding: boolean;
  currentProjectName: string;
  savedProjects: ProjectSummary[];
}

export function createInitialState(): AppState {
  return {
    status: "idle",
    errorMessage: null,
    spritePrompt: "",
    motionPrompt: "",
    motionModel: DEFAULT_VIDEO_MODEL,
    videoModels: [],
    spriteSrc: null,
    spriteDimensions: null,
    frames: [],
    selectedFrameIndices: new Set(),
    spritesheetSrc: null,
    spritesheetCols: null,
    previewGifSrc: null,
    previewGifBuilding: false,
    currentProjectName: "latest",
    savedProjects: [],
  };
}

export function cacheBust(url: string | null, key: string): string | null {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(key)}`;
}

export function hydrateFromView(view: ProjectView): Partial<AppState> {
  const v = view.updatedAt;
  return {
    spritePrompt: view.spritePrompt,
    motionPrompt: view.motionPrompt,
    motionModel: view.motionModel || DEFAULT_VIDEO_MODEL,
    spriteSrc: cacheBust(view.spriteUrl, v),
    spriteDimensions: view.spriteDimensions,
    frames: view.frames.map((f) => cacheBust(f, v)!),
    selectedFrameIndices: new Set(view.selectedFrameIndices),
    spritesheetSrc: cacheBust(view.spritesheetUrl, v),
    spritesheetCols: view.spritesheetUrl ? view.selectedFrameIndices.length : null,
    previewGifSrc: cacheBust(view.previewGifUrl, v),
    previewGifBuilding: false,
    currentProjectName: view.name,
  };
}

type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
}
