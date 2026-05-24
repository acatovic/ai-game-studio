# AGENTS.md

## Project

A lightweight web app for creating 2D game sprites from text prompts, turning the generated sprite into an image-to-video motion sequence, extracting transparent-background frames, and composing them into a 1×N spritesheet with a looping animated preview. Named projects can be saved, listed, loaded, and deleted; the in-progress state always lives in `projects/latest/` and is auto-persisted.

The app is implemented as a Vite + TypeScript single-page client and a small Express server (run concurrently in dev via `tsx watch`). Keep the UI lightweight and avoid heavy UI libraries.

## Non-negotiable requirements

- The UI must adhere closely to `mockup.png` (the three-column "Sprite Sheet Builder" layout).
- Use xAI / Grok Imagine for image and video generation.
- Expect `XAI_API_KEY` to be defined in a local `.env` file.
- Never expose `XAI_API_KEY` in client-side code.
- All xAI calls go through server-side routes; the browser never talks to xAI directly.
- Generated artifacts live under `projects/` (gitignored). Source frames, videos, spritesheets, gifs, and the working manifest are never committed.
- Do not commit `.env`, `projects/`, `frames/`, `*.mp4`, `*.mov`, `*.webm`.

## Expected environment

`.env.example` documents:

```bash
XAI_API_KEY=
```

Developer copies it locally:

```bash
cp .env.example .env
```

Dependencies that the project requires:

```bash
npm install ai @ai-sdk/xai express
npm install -D vite typescript tsx concurrently dotenv @types/express @types/node
```

The `ai` and `@ai-sdk/xai` packages must be a version that exports `experimental_generateVideo` and `xai.video()`. At the time of writing those are `ai@beta` and `@ai-sdk/xai@4.0.0-canary.66` or newer. The stable v5 / v2 releases do not yet expose video generation.

`ffmpeg` must be available on `PATH` — used for both frame extraction (with chroma-key alpha) and animated GIF preview build.

## UI requirements

Use `mockup.png` as the source of truth for the three-column layout, spacing, and visual hierarchy. The UI supports:

1. A prompt input for the initial reference sprite.
2. A "Generate Reference Sprite" button.
3. A preview area for the generated sprite (with dimensions caption).
4. A motion / sequence description input (e.g. "walking left", "jump", "attack right").
5. A "Generate Frames" button that runs xAI image-to-video, downloads the clip, and extracts transparent PNG frames.
6. A scrollable grid of every extracted frame, each tile click-toggleable to include/exclude it from the spritesheet.
7. A "Generate Spritesheet" button that composes the selected frames client-side into a 1×N PNG.
8. A horizontally scrollable spritesheet preview, an Export PNG button, and a looping animated GIF preview.
9. Header controls: New (start fresh), Load (dropdown of saved projects with delete), Save (prompt-for-name with overwrite confirm), and a label showing the current project name (`untitled` when unsaved).
10. Clear loading, success, and error states inline near each step. Buttons disable while their work is in flight.

Keep the interface focused on sprite creation. Do not add unrelated dashboards, auth, billing, social features, or project-management bloat.

## Implementation architecture

```text
.
├── AGENTS.md
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
│   ├── xai-image.ts              # sprite generation with chroma directive
│   ├── xai-video.ts              # motion video with chroma directive
│   ├── extract-frames.ts         # ffmpeg wrapper with chromakey
│   └── build-gif.ts              # animated preview GIF build
├── scripts/
│   └── extract-frames.sh         # ffmpeg chromakey + scale → transparent PNGs
└── projects/                     # gitignored
    ├── latest/                   # working state
    │   ├── sprite.json
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

- `GET /api/health` → `{ ok, hasApiKey }`.
- `GET /api/projects/current` → current `projects/latest/` view (hydrated with URLs).
- `GET /api/projects` → array of saved snapshots `{ name, updatedAt }`, newest first.
- `POST /api/projects/new` → wipes `projects/latest/`, returns empty view.
- `POST /api/projects/save { name }` → stamps `latest`'s manifest with the new name and copies it to `projects/<name>/`. Overwrites any existing snapshot. Reserved name `"latest"` is rejected.
- `POST /api/projects/load { name }` → wipes `latest/`, copies the named snapshot into `latest/`, returns the hydrated view.
- `POST /api/projects/delete { name }` → removes a named snapshot.
- `POST /api/projects/selection { selectedIndices: number[] }` → debounced persistence of the user's frame selection. Body validated as an array of numbers.
- `POST /api/projects/spritesheet { dataUrl }` → writes `projects/latest/spritesheet.png` and best-effort builds `projects/latest/preview.gif` from the current selection. Returns the updated view. GIF build failures are logged but do not fail the request.
- `POST /api/sprites/generate { prompt }` → calls xAI, wipes downstream artifacts in `latest/`, writes `latest/ref/sprite.png`, parses PNG dimensions, returns `{ view, dataUrl }`.
- `POST /api/sprites/animate { image, text, duration? }` → resolves `image` (either a `data:` URL or a `/projects/...` path with query strings stripped), calls xAI image-to-video, downloads the clip to `latest/source.mp4`, runs the extraction script into `latest/frames/`, returns the updated view.

All error responses are `{ error: string }` with `xai-...` tokens redacted.

## Initial sprite image generation

Use the xAI image API via the AI SDK. The model uses `size`, not `aspectRatio` (the SDK will warn if you pass `aspectRatio`).

```ts
import { xai } from "@ai-sdk/xai";
import { experimental_generateImage as generateImage } from "ai";

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

export async function generateSpriteImage(prompt: string): Promise<string> {
  const { image } = await generateImage({
    model: xai.image("grok-imagine-image-quality"),
    prompt: `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`,
    size: "1024x1024",
  });
  return image.base64;
}
```

Notes:

- Use `grok-imagine-image-quality`.
- Default to `size: "1024x1024"`.
- The chroma directive is appended server-side to every prompt — the UI lets the user write natural prompts; the keyable background is enforced behind the scenes.
- Convert the returned base64 to a data URL for preview: `data:image/png;base64,${base64}`.
- Save to `projects/latest/ref/sprite.png` and parse PNG header bytes 16–23 to get dimensions for the caption.

## Motion / sequence generation

Two-stage flow:

1. Generate a short video from the still sprite + the user's motion description.
2. Extract transparent PNG frames from the clip with the chroma-key + scale ffmpeg filter.

```ts
import { xai } from "@ai-sdk/xai";
import { experimental_generateVideo as generateVideo } from "ai";

const CHROMA_DIRECTIVE =
  "Maintain the exact same flat solid pure chroma green background, " +
  "hex #00b140, throughout the entire clip. No background changes, no " +
  "environmental elements, no shadows on the background, no camera movement. " +
  "The subject animates against the uniform green backdrop.";

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration = 2,
): Promise<string> {
  const result = await generateVideo({
    model: xai.video("grok-imagine-video"),
    prompt: { image, text: `${text.trim()}\n\n${CHROMA_DIRECTIVE}` },
    duration,
  });
  const videoUrl = (result as unknown as {
    providerMetadata?: { xai?: { videoUrl?: string } };
  }).providerMetadata?.xai?.videoUrl;
  if (!videoUrl) throw new Error("xAI did not return a video URL.");
  return videoUrl;
}
```

Notes:

- Default duration is `2` seconds (kept short to keep frame count reasonable and to keep iteration fast).
- `image` can be a `data:` URL (fresh generation) or a `/projects/...` path (after a load) — the server resolves the latter by stripping any `?v=...` cache-bust query and reading the file from disk before calling xAI.
- The motion chroma directive ensures the background stays keyable for every frame.

## Chroma key + transparency

The keyable color `#00b140` is referenced in three places — keep them in sync if you ever change it:

1. `server/xai-image.ts` — `CHROMA_DIRECTIVE` includes the hex in the natural-language prompt.
2. `server/xai-video.ts` — same hex in the video prompt.
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

### Save flow

1. Validate the user-supplied name against `^[a-zA-Z0-9_-]{1,40}$`. Reject `"latest"`.
2. Stamp the new name onto `projects/latest/sprite.json` first.
3. `rm -rf projects/<name>/` if it exists, then `cp -r projects/latest/ projects/<name>/`.
4. Return the hydrated view (built from the latest manifest after the rename).

### Load flow

1. Validate the name.
2. `rm -rf projects/latest/`, then `cp -r projects/<name>/ projects/latest/`.
3. Do not modify the manifest's `name` field — the snapshot already has the correct conceptual name and we want to preserve it on `latest`.
4. Return the hydrated view.

### Wiping rules

- New sprite generation wipes `latest/frames/`, `latest/spritesheet.png`, `latest/preview.gif` and clears the corresponding manifest fields.
- New motion / frames generation wipes the spritesheet and gif (frames are about to be overwritten by ffmpeg).
- `POST /api/projects/new` wipes the entire `latest/` directory and returns an empty view.

### Cache busting

Project assets are served from a stable URL (`/projects/latest/ref/sprite.png`, etc.) and rewritten on load. The browser must be told to refetch. `hydrateFromView` appends `?v=<updatedAt>` to every URL it returns (sprite, every frame, spritesheet, preview gif). `generateSprite` / `generateFrames` handlers also cache-bust the URLs they store in state so in-session regenerations show fresh pixels. The server strips the query string before resolving any `/projects/...` reference back to a filesystem path.

### Selection persistence

Toggling a frame tile triggers a 700 ms debounced `POST /api/projects/selection` that updates `selectedFrameIndices` in the manifest. The user does not need to click Save for selection state to survive a refresh.

## Animated GIF preview

After every spritesheet compose, `POST /api/projects/spritesheet` also builds a looping GIF preview at `projects/latest/preview.gif`. The build is best-effort — if ffmpeg fails for some reason, the spritesheet still persists and the UI surfaces the gif failure inline without disrupting the rest of the flow.

The build copies selected frames (sorted) into a temp `.tmp-gif/` dir under renumbered names (`frame-00001.png`, …), runs ffmpeg, then deletes the temp dir:

```text
scale=-1:200,split [a][b]; [a] palettegen=reserve_transparent=on [p]; [b][p] paletteuse=dither=bayer:bayer_scale=5
```

- Scales to height 200 px so a 145-frame clip is roughly 2 MB rather than 12 MB.
- `reserve_transparent=on` + the chroma-keyed alpha gives single-bit GIF transparency. Edges will be hard (no soft alpha). If soft alpha matters, swap to WebP/APNG.
- 12 fps. Adjustable per call via the `fps` parameter on `buildPreviewGif`.

The client renders the gif via a plain `<img>` (auto-loops) in a small 180 px-tall preview box below the Export PNG footer.

## End-to-end user flow

1. User opens the app. Boot fetches `/api/projects/current` and `/api/projects` to hydrate the most recent working state and populate the Load menu.
2. User enters a sprite prompt → `POST /api/sprites/generate` → server appends chroma directive, calls xAI, writes `latest/ref/sprite.png`, parses dimensions, returns `{ view, dataUrl }`.
3. UI shows the sprite (data URL for instant display) on the green chroma background.
4. User enters a motion prompt → `POST /api/sprites/animate` → server appends chroma directive, calls xAI, downloads video to `latest/source.mp4`, runs `extract-frames.sh` (chromakey → scale → RGBA PNG sequence) into `latest/frames/`.
5. UI shows every extracted frame in a scrollable 4-column grid, all selected by default.
6. User toggles tiles to refine the selection. Selection persists via debounced PATCH.
7. User clicks "Generate Spritesheet" → client composes a 1×N PNG at 128 px per cell via Canvas, displays it in the horizontally scrollable preview, and POSTs the dataUrl. Server saves it and best-effort builds the animated GIF preview.
8. UI shows the GIF preview below the spritesheet footer.
9. User can Export PNG, or Save the project under a name, or Load another, or hit New to start over.

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

- Missing `XAI_API_KEY` (health-check warning on boot, plus a 500 on any xAI-backed endpoint).
- Empty prompt.
- xAI generation failure.
- Missing video URL.
- Video download failure.
- `ffmpeg` missing.
- Frame extraction produced zero frames.
- Unsupported image / video format.
- Invalid project name (whitespace, special chars, > 40 chars, or `"latest"`).
- "Project not found" on load/delete.
- "Nothing to save" when `latest/` doesn't exist yet.
- GIF build failure (non-fatal — spritesheet still saves; status line surfaces it).

Server logs redact `xai-...` tokens before printing.

## Security requirements

- All xAI calls server-side.
- Never log `XAI_API_KEY`. Redact `xai-...` substrings in error messages.
- No arbitrary shell commands from the client.
- All file paths going to ffmpeg or `fs.cp`/`rm` are validated with `ensureInsideRoot`.
- Project names validated with `safeProjectName` (`^[a-zA-Z0-9_-]{1,40}$`, `"latest"` reserved).
- Request payloads validated before doing any work.

## Coding style

- Small, focused functions; typed request/response shapes.
- App state managed by a tiny `Store` with a single `subscribe` listener that re-renders. No heavy framework.
- Generated output state is explicit: `idle`, `generating-image`, `generating-video`, `extracting-frames`, `done`, `error`.
- Buttons disable while their work is in flight to prevent duplicate submissions.
- Keep dependencies minimal.

## Testing checklist

Before considering the implementation done:

- `npm install` works from a clean checkout.
- `.env.example` exists and documents `XAI_API_KEY`.
- `npm run dev` starts Vite (:5173) and Express (:8787) together.
- UI visually matches `mockup.png` (3-column card layout, header with New / Load / Save).
- Initial sprite generation lands the file at `projects/latest/ref/sprite.png` and shows the dimensions caption.
- Motion generation downloads to `projects/latest/source.mp4` and produces transparent PNGs in `projects/latest/frames/`.
- Frame grid scrolls and supports click-to-toggle selection.
- "Generate Spritesheet" composes a 1×N PNG and produces `projects/latest/preview.gif`.
- Export PNG downloads the composed spritesheet.
- Save creates `projects/<name>/` with a full copy and a manifest whose `name` field matches.
- Load swaps `projects/latest/` to the named snapshot's contents and the header label updates immediately.
- New wipes `projects/latest/` and resets the UI to untitled.
- Delete removes a named snapshot from disk and from the Load dropdown.
- Frame selection persists across refresh via the debounced selection endpoint.
- Cache-busting works: loading a different project shows that project's frames in the grid (not the previous project's).
- Missing API key shows a useful error.
- Generated outputs are ignored by git.
- No secrets are exposed to the browser or logs.
