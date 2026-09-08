import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export const PROJECTS_DIR = path.resolve(process.env.AI_GAME_STUDIO_HOME || path.join(os.homedir(), ".ai-game-studio"));
export async function initializeStorage(): Promise<void> {
  await mkdir(PROJECTS_DIR, { recursive: true });
}
