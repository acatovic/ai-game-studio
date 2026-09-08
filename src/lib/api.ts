export interface ProjectView {
  project: { version: 1; name: string; activeSpriteId: string; sprites: { id: string; name: string; path: string }[] };
  name: string;
  spritePrompt: string;
  spriteModel: string;
  motionPrompt: string;
  motionModel: string;
  spriteUrl: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: number[];
  spritesheetUrl: string | null;
  previewGifUrl: string | null;
  updatedAt: string;
}

export interface VideoModelOption {
  id: string;
  label: string;
  defaultDuration: number;
}

export interface ImageModelOption {
  id: string;
  label: string;
}

export interface ImageModelsResponse {
  models: readonly ImageModelOption[];
  default: string;
}

export interface VideoModelsResponse {
  models: readonly VideoModelOption[];
  default: string;
}

export interface ProjectSummary {
  name: string;
  updatedAt: string;
}

export interface GenerateSpriteResponse {
  view: ProjectView;
  dataUrl: string;
}

let activeProject: { name: string; spriteId: string } | null = null;
export function setActiveProject(view: ProjectView | null): void {
  activeProject = view ? { name: view.name, spriteId: view.project.activeSpriteId } : null;
}
function contextHeaders(): Record<string, string> {
  return activeProject ? { "X-Project-Name": activeProject.name, "X-Sprite-Id": activeProject.spriteId } : {};
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...contextHeaders() },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: contextHeaders() });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export function generateSprite(
  prompt: string,
  model?: string,
): Promise<GenerateSpriteResponse> {
  return postJson("/api/sprites/generate", { prompt, model });
}

export function animateSprite(
  image: string,
  text: string,
  model?: string,
): Promise<ProjectView> {
  return postJson("/api/sprites/animate", { image, text, model });
}

export function getVideoModels(): Promise<VideoModelsResponse> {
  return getJson("/api/models/video");
}

export function getImageModels(): Promise<ImageModelsResponse> {
  return getJson("/api/models/image");
}

export function listProjects(): Promise<ProjectSummary[]> {
  return getJson("/api/projects");
}

export function saveProject(): Promise<ProjectView> {
  return postJson("/api/projects/save", {});
}

export function loadProject(name: string): Promise<ProjectView> {
  return postJson("/api/projects/load", { name });
}

export function deleteProject(name: string): Promise<{ ok: boolean }> {
  return postJson("/api/projects/delete", { name });
}

export function newProject(name: string): Promise<ProjectView> {
  return postJson("/api/projects/new", { name });
}

export function saveSelection(selectedIndices: number[]): Promise<ProjectView> {
  return postJson("/api/projects/selection", { selectedIndices });
}

export function saveSpritesheet(dataUrl: string): Promise<ProjectView> {
  return postJson("/api/projects/spritesheet", { dataUrl });
}

export async function checkHealth(): Promise<{ ok: boolean; hasApiKey: boolean }> {
  const res = await fetch("/api/health");
  return res.json();
}

export function changeSprite(action: "new" | "load" | "rename", value: string): Promise<ProjectView> {
  return postJson(`/api/projects/sprites/${action}`, { value });
}
export function saveDraft(draft: { spritePrompt: string; motionPrompt: string; spriteModel: string; motionModel: string }): Promise<ProjectView> {
  return postJson("/api/projects/draft", draft);
}
