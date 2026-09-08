# AGENTS.md

## Current project storage and startup

The project implementation now supersedes the older working-copy/snapshot details below:

- Startup shows a centered **New Project** / **Open** screen; do not auto-open a project.
- Store projects in `$HOME/.ai-game-studio/<name>/` by default. `AI_GAME_STUDIO_HOME` overrides the storage root.
- `npm install` creates the storage directory via `scripts/install.ts`; the server also ensures it exists.
- Each project has a versioned JSON `.project` manifest and `sprites/<id>/sprite.json` plus that sprite's artifacts.
- Edit sprites directly in their own directories. There is no `latest` directory, shared working copy, or snapshot copy on Save/Open.
- API requests identify their project and sprite through `X-Project-Name` / `X-Sprite-Id`, scoped with AsyncLocalStorage.
- Validate generated paths against the configured storage root, while extraction scripts still live in the source checkout.
- Save, sprite switching, and Close project persist draft prompts and selections. Close returns to the start screen.
- Run `npm run build` and `node --import tsx --test tests/*.test.ts` for project-storage changes.

## Project

A lightweight web app — and the seed of a larger AI Game Studio — for generating 2D game assets from text prompts. Today: reference sprites and animation frames composed into a 1×N spritesheet with a looping animated preview. The app uses [OpenRouter](https://openrouter.ai) as the single boundary to the model providers, which gives access to 300+ image / video / audio / text models behind one API key. New asset types (backgrounds, tilemaps, SFX, music, voice) plug into the same pattern.

The app is implemented as a Vite + TypeScript single-page client and a small Express server (run concurrently in dev via `tsx watch`). Keep the UI lightweight and avoid heavy UI libraries. The server makes raw `fetch` calls to OpenRouter — no provider SDKs.

## Non-negotiable requirements

- The UI must adhere closely to `mockup.png` (the three-column "Sprite Sheet Builder" layout).
- Use OpenRouter as the single boundary between the browser and any model provider.
- Expect `OPENROUTER_API_KEY` to be defined in a local `.env` file.
- Never expose `OPENROUTER_API_KEY` in client-side code.
- All model calls go through server-side routes; the browser never talks to OpenRouter or any provider directly.
- Generated artifacts live under `projects/` (gitignored). Source frames, videos, spritesheets, gifs, and the working manifest are never committed.
- Do not commit `.env`, `projects/`, `frames/`, `*.mp4`, `*.mov`, `*.webm`.

## Expected environment

`.env.example` documents:

```bash
OPENROUTER_API_KEY=
```

Developer copies it locally:

```bash
cp .env.example .env
```

Dependencies the project requires:

```bash
npm install express
npm install -D vite typescript tsx concurrently dotenv @types/express @types/node
```

No provider SDK is used. The server hits OpenRouter directly with `fetch`. This keeps the server independent of any one provider's release cadence and makes it trivial to add new model types.

`ffmpeg` must be available on `PATH` — used for both frame extraction (with chroma-key alpha) and animated GIF preview build.

## UI requirements

Use `mockup.png` as the source of truth for the three-column layout, spacing, and visual hierarchy. The UI supports:

1. A prompt input for the initial reference sprite.
2. A "Generate Reference Sprite" button.
3. A preview area for the generated sprite (with dimensions caption).
4. A motion / sequence description input (e.g. "walking left", "jump", "attack right").
5. A **video model selector** (dropdown) above the Generate Frames button. Options come from `GET /api/models/video`. Default: `x-ai/grok-imagine-video`.
6. A "Generate Frames" button that runs the chosen model via OpenRouter, downloads the clip, and extracts transparent PNG frames.
7. A scrollable grid of every extracted frame, each tile click-toggleable to include/exclude it from the spritesheet.
8. A "Generate Spritesheet" button that composes the selected frames client-side into a 1×N PNG.
9. A horizontally scrollable spritesheet preview, an Export PNG button, and a looping animated GIF preview.
10. Header controls: New (start fresh), Load (dropdown of saved projects with delete), Save (prompt-for-name with overwrite confirm), and a label showing the current project name (`untitled` when unsaved).
11. Clear loading, success, and error states inline near each step. Buttons disable while their work is in flight.

Keep the interface focused on sprite creation. Future asset types (backgrounds, audio, etc.) are scoped as separate panels or columns — don't bolt unrelated dashboards/auth/billing onto this one.

## Implementation architecture

```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── mockup.png
├── package.json
├── tsconfig.json
├── vite.config.ts                # proxies /api and /projects → :8787
├── index.html
├── src/
│   ├── main.ts                   # entry
│   ├── app.ts                    # shell + handlers + render loop
│   ├── lib/
│   │   ├── api.ts                # fetch wrappers + types
│   │   ├── state.ts              # Store, hydrateFromView, cacheBust
│   │   └── spritesheet.ts        # canvas-based composer
│   ├── components/
│   │   └── icons.ts              # inline SVG icons
│   └── styles/
│       └── main.css
├── server/
│   ├── index.ts                  # Express app + route handlers
│   ├── files.ts                  # paths, PNG dim parser, safe name
│   ├── projects.ts               # manifest read/write, save/load
│   ├── image.ts                  # OpenRouter chat-completions image gen
│   ├── video.ts                  # OpenRouter /api/v1/videos + model registry
│   ├── extract-frames.ts         # ffmpeg wrapper with chromakey
│   └── build-gif.ts              # animated preview GIF build
├── scripts/
│   └── extract-frames.sh         # ffmpeg chromakey + scale → transparent PNGs
└── projects/                     # gitignored
    ├── latest/                   # working state
    │   ├── sprite.json           # manifest
    │   ├── ref/sprite.png
    │   ├── source.mp4
    │   ├── frames/frame-XXXXX.png
    │   ├── spritesheet.png
    │   └── preview.gif
    └── <name>/                   # snapshots after Save
        └── (same layout)
```

The Express server listens on port 8787 (configurable via `PORT`). Vite dev server runs on 5173 and proxies `/api/*` and `/projects/*` to the backend. `npm run dev` starts both concurrently.

Use TypeScript everywhere. Strict mode on.

### Server endpoints

- `GET /api/health` → `{ ok, hasApiKey }`. `hasApiKey` reflects `OPENROUTER_API_KEY` being set.
- `GET /api/models/video` → `{ models: [{ id, label, defaultDuration }, ...], default: "x-ai/grok-imagine-video" }`. The list is the single source of truth for the client's model dropdown and the server's allowlist.
- `GET /api/projects/current` → current `projects/latest/` view (hydrated with URLs).
- `GET /api/projects` → array of saved snapshots `{ name, updatedAt }`, newest first.
- `POST /api/projects/new` → wipes `projects/latest/`, returns empty view.
- `POST /api/projects/save { name }` → stamps `latest`'s manifest with the new name and copies it to `projects/<name>/`. Overwrites any existing snapshot. Reserved name `"latest"` is rejected.
- `POST /api/projects/load { name }` → wipes `latest/`, copies the named snapshot into `latest/`, returns the hydrated view.
- `POST /api/projects/delete { name }` → removes a named snapshot.
- `POST /api/projects/selection { selectedIndices: number[] }` → debounced persistence of the user's frame selection.
- `POST /api/projects/spritesheet { dataUrl }` → writes `projects/latest/spritesheet.png` and best-effort builds `projects/latest/preview.gif` from the current selection. Returns the updated view.
- `POST /api/sprites/generate { prompt }` → calls OpenRouter chat-completions, writes `latest/ref/sprite.png`, parses PNG dimensions, returns `{ view, dataUrl }`.
- `POST /api/sprites/animate { image, text, model?, duration? }` → resolves `image` (either a `data:` URL or a `/projects/...` path with query strings stripped), validates `model` against the allowlist, calls OpenRouter `/api/v1/videos` with the chosen model's `defaultDuration` if not overridden, polls until `completed`, downloads the clip, runs frame extraction, returns the updated view.

All error responses are `{ error: string }` with `sk-or-...` and `xai-...` tokens redacted.

## Initial sprite image generation

Image generation goes through OpenRouter's chat-completions endpoint with `modalities: ["image"]`. Default model is `x-ai/grok-imagine-image-quality` (image-only output; do **not** include `"text"` in the modalities array — the model rejects it).

```ts
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

export async function generateSpriteImage(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "x-ai/grok-imagine-image-quality",
      modalities: ["image"],
      messages: [{ role: "user", content: `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}` }],
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);

  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter response did not include an image");

  // Most providers return data: URLs; some return HTTPS — handle both.
  if (url.startsWith("data:")) {
    const m = url.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    if (!m) throw new Error("malformed image data URL");
    return m[1];
  }
  const imgRes = await fetch(url);
  return Buffer.from(await imgRes.arrayBuffer()).toString("base64");
}
```

Notes:

- The chroma directive is appended server-side so the UI's prompt input stays natural.
- Convert the returned base64 to a data URL for preview: `data:image/png;base64,${base64}`.
- Save to `projects/latest/ref/sprite.png` and parse PNG header bytes 16–23 to get dimensions for the caption.
- If you swap to a different image model later, only the `model` string changes; the rest of the chat-completions shape is provider-agnostic.

## Motion / sequence generation

Two-stage flow:

1. Submit the job via OpenRouter `/api/v1/videos`, then poll `polling_url` until `completed`.
2. Download the produced MP4 to `projects/latest/source.mp4` and extract transparent PNG frames with the chroma-key + scale ffmpeg filter.

### Model registry

The server owns the allowlist of selectable video models. Adding a new one is a single entry in `server/video.ts`:

```ts
export const VIDEO_MODELS = [
  { id: "x-ai/grok-imagine-video", label: "Grok Imagine Video", defaultDuration: 2 },
  { id: "bytedance/seedance-2.0", label: "Seedance 2.0",       defaultDuration: 4 },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
export const DEFAULT_VIDEO_MODEL: VideoModelId = "x-ai/grok-imagine-video";

export function isVideoModelId(v: unknown): v is VideoModelId {
  return typeof v === "string" && VIDEO_MODELS.some((m) => m.id === v);
}

export function defaultDurationFor(id: VideoModelId): number {
  return VIDEO_MODELS.find((m) => m.id === id)!.defaultDuration;
}
```

`defaultDuration` matters because different models have different allowed ranges (Grok accepts `2`s; Seedance requires 4–15s). The animate endpoint applies the per-model default if the client didn't pass one. The `/api/models/video` endpoint exposes the list to the client.

### Submit + poll + download

```ts
const CHROMA_DIRECTIVE =
  "Maintain the exact same flat solid pure chroma green background, " +
  "hex #00b140, throughout the entire clip. No background changes, no " +
  "environmental elements, no shadows on the background, no camera movement.";

export interface VideoDownload {
  url: string;
  headers?: Record<string, string>;
}

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration: number,
  model: VideoModelId,
): Promise<VideoDownload> {
  const apiKey = process.env.OPENROUTER_API_KEY!;

  // 1. submit
  const submitRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `${text.trim()}\n\n${CHROMA_DIRECTIVE}`,
      duration,
      input_references: [{ type: "image_url", image_url: { url: image } }],
    }),
  });
  let job = await submitRes.json();
  if (!submitRes.ok || !job.id) throw new Error(job.error?.message ?? `HTTP ${submitRes.status}`);

  // 2. poll polling_url every ~3s
  for (let i = 0; i < 100; i++) {
    if (job.status === "completed") break;
    if (["failed", "cancelled", "expired"].includes(job.status)) {
      throw new Error(`OpenRouter video ${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    const pollUrl = new URL(job.polling_url, "https://openrouter.ai").toString();
    const pollRes = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    job = await pollRes.json();
  }
  if (job.status !== "completed") throw new Error("video did not complete in time");

  // 3. return download target. unsigned_urls pointing back at openrouter.ai still need the bearer.
  const unsigned = job.unsigned_urls?.[0];
  const auth = { Authorization: `Bearer ${apiKey}` };
  if (unsigned) {
    return isOpenRouterHost(unsigned) ? { url: unsigned, headers: auth } : { url: unsigned };
  }
  return { url: `${OPENROUTER_BASE}/videos/${job.id}/content?index=0`, headers: auth };
}
```

Notes:

- The motion chroma directive ensures the background stays keyable for every frame.
- `image` can be a `data:` URL (fresh generation) or a `/projects/...` path (after a load) — the server resolves the latter by stripping any `?v=...` cache-bust query and reading the file from disk before calling OpenRouter.
- `unsigned_urls` returned by OpenRouter are usually publicly readable, but when they point back to `openrouter.ai` the bearer token is still required. Always parse the hostname before deciding whether to send the `Authorization` header — never send it to an arbitrary host.
- The downloader (`server/files.ts`) takes an optional `headers` arg and forwards them to `fetch`.

## Chroma key + transparency

The keyable color `#00b140` is referenced in three places — keep them in sync if you ever change it:

1. `server/image.ts` — `CHROMA_DIRECTIVE` includes the hex in the natural-language prompt.
2. `server/video.ts` — same hex in the video prompt.
3. `scripts/extract-frames.sh` — `chromakey=0x00b140:0.15:0.08` in the ffmpeg filter.

Tuning hints:

- Edge fringe / green halos → bump `blend` (third arg of `chromakey`) from `0.08` → `0.12`.
- Holes in the character (metal, reflections) → drop `similarity` (second arg) from `0.15` → `0.10`.

The reference-sprite preview in column 1 intentionally still shows the green background — it's the *source* image, and keeping the green visible is a useful signal that the chroma layer is doing its job.

## Frame extraction script

`scripts/extract-frames.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

in="${1:?usage: $0 input.mp4 [output_dir]}"
dir="${2:-frames}"

mkdir -p "$dir"

ffmpeg -hide_banner -y \
  -i "$in" \
  -vf "chromakey=0x00b140:0.15:0.08,scale=320:-1,format=rgba" \
  -start_number 1 \
  "$dir/frame-%05d.png"

echo "Wrote frames to: $dir"
```

Make it executable. Call it from Node with `child_process.spawn`, never string-concatenated shell, and only with absolute paths inside the project root (`ensureInsideRoot`). The wrapper clears stale PNGs from the target directory before invoking ffmpeg so the previous run's frames cannot leak into the new one.

## Project save / load

The "working state" always lives in `projects/latest/`. Named snapshots live alongside: `projects/<name>/`. Both have the same internal layout. `projects/latest/sprite.json` is the source of truth for what the UI shows.

### Manifest schema (`sprite.json`)

```json
{
  "name": "eric-draven",
  "spritePrompt": "...",
  "motionPrompt": "...",
  "motionModel": "x-ai/grok-imagine-video",
  "sprite": "ref/sprite.png",
  "spriteDimensions": { "w": 1024, "h": 1024 },
  "frames": ["frames/frame-00001.png", "..."],
  "selectedFrameIndices": [0, 1, 2],
  "spritesheet": "spritesheet.png",
  "previewGif": "preview.gif",
  "updatedAt": "2026-05-23T10:00:00.000Z"
}
```

- Paths inside the manifest are **relative to the project directory**. URLs are built at view time against `/projects/latest/` (the working state is always served from there, regardless of which project is loaded).
- `name` is the *conceptual* project label — for `latest/` it can be `"latest"` (untitled), the name of the loaded snapshot, or the name the user just saved as. The directory and the `name` field are decoupled. `readManifest` and `writeManifest` never overwrite the `name` field with the directory name.
- `motionModel` records the video model the last `Generate Frames` run used. A loaded project pre-selects that model in the dropdown.

### Save / load / wipe rules

Save: validate name against `^[a-zA-Z0-9_-]{1,40}$`, reject `"latest"`, stamp the new name onto `latest/sprite.json`, then copy `latest/` to `projects/<name>/`.

Load: wipe `latest/`, copy `projects/<name>/` to `latest/`. Do **not** modify the manifest's `name` after copying — the snapshot already has the right conceptual name.

Wipe rules:

- New sprite generation wipes `latest/frames/`, `latest/spritesheet.png`, `latest/preview.gif` and clears the corresponding manifest fields.
- New motion / frames generation wipes the spritesheet and gif (frames are about to be overwritten by ffmpeg).
- `POST /api/projects/new` wipes the entire `latest/` directory and returns an empty view.

### Cache busting

Project assets are served from stable URLs (`/projects/latest/ref/sprite.png`, etc.) and rewritten on load. To force a refetch, `hydrateFromView` appends `?v=<updatedAt>` to every URL it returns (sprite, every frame, spritesheet, preview gif). `generateSprite` / `generateFrames` handlers cache-bust their freshly-returned URLs too so in-session regenerations show fresh pixels. The server strips the query string before resolving any `/projects/...` reference back to a filesystem path.

### Selection persistence

Toggling a frame tile triggers a 700 ms debounced `POST /api/projects/selection` that updates `selectedFrameIndices` in the manifest. The user does not need to click Save for selection state to survive a refresh.

## Animated GIF preview

After every spritesheet compose, `POST /api/projects/spritesheet` also builds a looping GIF preview at `projects/latest/preview.gif`. The build is best-effort — if ffmpeg fails for some reason, the spritesheet still persists and the UI surfaces the gif failure inline without disrupting the rest of the flow.

The build copies selected frames (sorted) into a temp `.tmp-gif/` dir under renumbered names, runs ffmpeg, then deletes the temp dir:

```text
scale=-1:200,split [a][b]; [a] palettegen=reserve_transparent=on [p]; [b][p] paletteuse=dither=bayer:bayer_scale=5
```

- Scales to height 200 px so a 145-frame clip is ~2 MB instead of ~12 MB.
- `reserve_transparent=on` + the chroma-keyed alpha gives single-bit GIF transparency. Edges will be hard (no soft alpha). If soft alpha matters, swap to WebP/APNG.
- 12 fps. Adjustable per call via the `fps` parameter on `buildPreviewGif`.

The client renders the gif via a plain `<img>` (auto-loops) in a small 180 px-tall preview box below the Export PNG footer.

## End-to-end user flow

1. User opens the app. Boot fetches `/api/projects/current`, `/api/projects`, and `/api/models/video` to hydrate the most recent working state, populate the Load menu, and fill the model dropdown.
2. User enters a sprite prompt → `POST /api/sprites/generate` → server appends chroma directive, calls OpenRouter chat-completions, writes `latest/ref/sprite.png`, parses dimensions, returns `{ view, dataUrl }`.
3. UI shows the sprite (data URL for instant display) on the green chroma background.
4. User picks a video model and enters a motion prompt → `POST /api/sprites/animate` → server appends chroma directive, submits the job to OpenRouter, polls until `completed`, downloads to `latest/source.mp4` (sending the bearer token if the URL is on `openrouter.ai`), runs `extract-frames.sh` (chromakey → scale → RGBA PNG sequence) into `latest/frames/`.
5. UI shows every extracted frame in a scrollable 4-column grid, all selected by default.
6. User toggles tiles to refine the selection. Selection persists via debounced PATCH.
7. User clicks "Generate Spritesheet" → client composes a 1×N PNG at 128 px per cell via Canvas, displays it in the horizontally scrollable preview, and POSTs the dataUrl. Server saves it and best-effort builds the animated GIF preview.
8. UI shows the GIF preview below the spritesheet footer.
9. User can Export PNG, Save the project under a name, Load another, or hit New to start over.

## File and output handling

`.gitignore`:

```gitignore
node_modules/
dist/
.DS_Store

.env
.env.local

projects/
frames/
*.mp4
*.mov
*.webm

*.log
```

When returning generated assets to the frontend, expose them through `/projects/` (mounted via `express.static`). Do not expose arbitrary filesystem paths. All save/load/delete name inputs go through `safeProjectName` validation. All `/projects/...` path-to-disk conversions go through `ensureInsideRoot` to refuse anything that escapes the project root.

## Error handling

Surface these cleanly in the UI without exposing server internals or secrets:

- Missing `OPENROUTER_API_KEY` (health-check warning on boot, plus a 500 on any OpenRouter-backed endpoint).
- Empty prompt.
- OpenRouter generation failure (image: 4xx with provider error message).
- Video job terminal failure (`failed | cancelled | expired`).
- Video polling timeout (job stuck `pending`/`in_progress` beyond the max attempts).
- Unsupported duration for the chosen model (provider returns 4xx with a hint).
- Video download failure (401, etc.).
- `ffmpeg` missing.
- Frame extraction produced zero frames.
- Unsupported image / video format.
- Invalid project name (whitespace, special chars, > 40 chars, or `"latest"`).
- "Project not found" on load/delete.
- "Nothing to save" when `latest/` doesn't exist yet.
- GIF build failure (non-fatal — spritesheet still saves; status line surfaces it).

Server logs and 4xx responses redact `sk-or-...` and `xai-...` substrings before printing.

## Security requirements

- All OpenRouter calls server-side.
- Never log `OPENROUTER_API_KEY`. Redact `sk-or-...` and `xai-...` substrings in error messages.
- Only send the `Authorization` header to OpenRouter hosts — parse `unsigned_urls` and skip the header if the hostname isn't `openrouter.ai` (or a subdomain).
- No arbitrary shell commands from the client.
- All file paths going to ffmpeg or `fs.cp`/`rm` are validated with `ensureInsideRoot`.
- Project names validated with `safeProjectName` (`^[a-zA-Z0-9_-]{1,40}$`, `"latest"` reserved).
- Request payloads validated before doing any work.

## Coding style

- Small, focused functions; typed request/response shapes.
- App state managed by a tiny `Store` with a single `subscribe` listener that re-renders. No heavy framework.
- Generated output state is explicit: `idle`, `generating-image`, `generating-video`, `extracting-frames`, `done`, `error`.
- Buttons disable while their work is in flight to prevent duplicate submissions.
- Keep dependencies minimal — raw `fetch` for the OpenRouter calls, no provider SDKs.

## Extending the studio

The shape established by `server/video.ts` is the template for new asset types:

- A typed registry (`AUDIO_MODELS`, `BG_MODELS`, …) lists model id + display label + any default parameters.
- A small generator module makes a typed `fetch` to OpenRouter, handles polling/streaming where needed, and returns a downloadable target (URL + optional headers).
- The Express layer adds a route and a `GET /api/models/<type>` endpoint that mirrors `GET /api/models/video`.
- The manifest gains a `<type>Model` field so the loaded project remembers the last choice.
- The client adds a panel (or extends a column), wires a dropdown driven by the new models endpoint, and reuses the existing project save/load/cache-bust plumbing.

This keeps each asset type self-contained and the surface area predictable.

## Testing checklist

Before considering changes done:

- `npm install` works from a clean checkout.
- `.env.example` exists and documents `OPENROUTER_API_KEY`.
- `npm run dev` starts Vite (:5173) and Express (:8787) together.
- UI visually matches `mockup.png` (3-column card layout, header with New / Load / Save, model dropdown in column 2).
- `GET /api/models/video` returns the allowlist; client dropdown is populated from it.
- Initial sprite generation lands the file at `projects/latest/ref/sprite.png` and shows the dimensions caption.
- Motion generation with Grok (default 2s) and Seedance (default 4s) both succeed end-to-end; manifest `motionModel` reflects the chosen model.
- Video download succeeds when `unsigned_urls` points back to `openrouter.ai` (bearer attached).
- Frame grid scrolls and supports click-to-toggle selection.
- "Generate Spritesheet" composes a 1×N PNG and produces `projects/latest/preview.gif`.
- Export PNG downloads the composed spritesheet.
- Save creates `projects/<name>/` with a full copy and a manifest whose `name` and `motionModel` survive.
- Load swaps `projects/latest/` to the named snapshot's contents; header label and model dropdown update immediately.
- New wipes `projects/latest/` and resets the UI to untitled.
- Delete removes a named snapshot from disk and from the Load dropdown.
- Frame selection persists across refresh via the debounced selection endpoint.
- Cache-busting works: loading a different project shows that project's frames in the grid (not the previous project's).
- Missing API key shows a useful error referencing `OPENROUTER_API_KEY`.
- Generated outputs are ignored by git.
- No secrets are exposed to the browser or logs.
