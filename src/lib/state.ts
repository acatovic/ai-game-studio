import type {
  ImageModelOption,
  ProjectSummary,
  ProjectView,
  VideoModelOption,
} from "./api";
import type { ReferenceView, ImageSourceOption } from "./character";
import { DEFAULT_FRAME_SIZE, type FrameSize } from "./frame-size";

export const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-flare";
export const DEFAULT_VIDEO_MODEL = "x-ai/grok-imagine-video";

export type AppStatus =
  | "idle"
  | "generating-image"
  | "generating-video"
  | "extracting-frames"
  | "done"
  | "error";

export interface AppState {
  referenceImage: ProjectView["referenceImage"];
  referenceImageLoading: boolean;
  referenceViews: Partial<Record<ReferenceView, string>>;
  referenceAlignment: ProjectView["referenceAlignment"];
  referenceView: ReferenceView;
  startImage: ImageSourceOption | null;
  endImage: ImageSourceOption | null;
  imageSources: ImageSourceOption[];
  project: ProjectView["project"] | null;
  navigating: boolean;
  activeAnimationId: string;
  animations: { id: string; name: string }[];
  asepriteSrc: string | null;
  status: AppStatus;
  errorMessage: string | null;
  spritePrompt: string;
  spriteModel: string;
  imageModels: ImageModelOption[];
  motionPrompt: string;
  motionModel: string;
  videoModels: VideoModelOption[];
  spriteSrc: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: Set<number>;
  frameSize: FrameSize;
  spritesheetFrameSize: number | null;
  spritesheetSrc: string | null;
  spritesheetCols: number | null;
  previewGifSrc: string | null;
  previewGifBuilding: boolean;
  currentProjectName: string;
  savedProjects: ProjectSummary[];
}

export function createInitialState(): AppState {
  return {
    referenceImage: null, referenceImageLoading: false,
    referenceViews: {}, referenceAlignment: null, referenceView: "side",
    startImage: null, endImage: null, imageSources: [],
    project: null,
    navigating: false,
    activeAnimationId: "",
    animations: [],
    asepriteSrc: null,
    status: "idle",
    errorMessage: null,
    spritePrompt: "",
    spriteModel: DEFAULT_IMAGE_MODEL,
    imageModels: [],
    motionPrompt: "",
    motionModel: DEFAULT_VIDEO_MODEL,
    videoModels: [],
    spriteSrc: null,
    spriteDimensions: null,
    frames: [],
    selectedFrameIndices: new Set(),
    frameSize: DEFAULT_FRAME_SIZE,
    spritesheetFrameSize: null,
    spritesheetSrc: null,
    spritesheetCols: null,
    previewGifSrc: null,
    previewGifBuilding: false,
    currentProjectName: "",
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
    referenceImage: view.referenceImage ? { ...view.referenceImage, url: cacheBust(view.referenceImage.url, v)! } : null,
    referenceViews: Object.fromEntries(Object.entries(view.referenceViews ?? (view.spriteUrl ? { side: view.spriteUrl } : {}))
      .map(([key, url]) => [key, cacheBust(url, v)!])),
    referenceAlignment: view.referenceAlignment ?? null,
    startImage: view.startImage ? { ...view.startImage, url: cacheBust(view.startImage.url, v)! } : null,
    endImage: view.endImage ? { ...view.endImage, url: cacheBust(view.endImage.url, v)! } : null,
    imageSources: (view.imageSources ?? []).map(option => ({ ...option, url: cacheBust(option.url, v)! })),
    project: view.project,
    activeAnimationId: view.activeAnimationId,
    animations: view.animations,
    asepriteSrc: cacheBust(view.asepriteUrl, v),
    spritePrompt: view.spritePrompt,
    spriteModel: view.spriteModel || DEFAULT_IMAGE_MODEL,
    motionPrompt: view.motionPrompt,
    motionModel: view.motionModel || DEFAULT_VIDEO_MODEL,
    spriteSrc: cacheBust(view.spriteUrl, v),
    spriteDimensions: view.spriteDimensions,
    frames: view.frames.map((f) => cacheBust(f, v)!),
    selectedFrameIndices: new Set(view.selectedFrameIndices),
    frameSize: view.frameSize ?? DEFAULT_FRAME_SIZE,
    spritesheetFrameSize: view.spritesheetUrl ? view.spritesheetFrameSize ?? DEFAULT_FRAME_SIZE : null,
    spritesheetSrc: cacheBust(view.spritesheetUrl, v),
    spritesheetCols: view.spritesheetUrl ? view.spritesheetFrameCount : null,
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
