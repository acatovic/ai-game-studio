export interface ProjectView {
  name: string;
  spritePrompt: string;
  motionPrompt: string;
  spriteUrl: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: number[];
  spritesheetUrl: string | null;
  previewGifUrl: string | null;
  updatedAt: string;
}

export interface ProjectSummary {
  name: string;
  updatedAt: string;
}

export interface GenerateSpriteResponse {
  view: ProjectView;
  dataUrl: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const res = await fetch(path);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export function generateSprite(prompt: string): Promise<GenerateSpriteResponse> {
  return postJson("/api/sprites/generate", { prompt });
}

export function animateSprite(image: string, text: string): Promise<ProjectView> {
  return postJson("/api/sprites/animate", { image, text });
}

export function getCurrentProject(): Promise<ProjectView> {
  return getJson("/api/projects/current");
}

export function listProjects(): Promise<ProjectSummary[]> {
  return getJson("/api/projects");
}

export function saveProject(name: string): Promise<ProjectView> {
  return postJson("/api/projects/save", { name });
}

export function loadProject(name: string): Promise<ProjectView> {
  return postJson("/api/projects/load", { name });
}

export function deleteProject(name: string): Promise<{ ok: boolean }> {
  return postJson("/api/projects/delete", { name });
}

export function newProject(): Promise<ProjectView> {
  return postJson("/api/projects/new", {});
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
