# AI Game Studio

A local web app — and the start of a fuller AI Game Studio — for generating game assets from text prompts. Today: 2D reference sprites and animation frames composed into a 1×N spritesheet with a looping animated preview. Backgrounds are chroma-keyed to transparency automatically, so frames drop straight into a game engine. Projects can be saved and loaded by name.

The app talks to [OpenRouter](https://openrouter.ai) as the single boundary to the model providers. One key gives access to 300+ image / video / audio / text models, which is the runway for everything on the TO-DO list (backgrounds, tilemaps, SFX, music, voice, …).

Pick both image and video models at generation time. Image options are **OpenAI GPT Image 2** (default) and **xAI Grok Imagine Image 2.0**; video options are **Grok Imagine Video** (xAI), **MiniMax H3**, and **Seedance 2.0** (ByteDance). All generation is routed through OpenRouter.

![Mockup](mockup.png)

Full Demo: https://www.youtube.com/watch?v=MijheSPXnDo

## Requirements

- Node 20+
- `ffmpeg` on `PATH`
- An [OpenRouter API key](https://openrouter.ai/keys)

## Install

```bash
npm install

cp .env.example .env
# then open .env and paste your key:
# OPENROUTER_API_KEY=sk-or-v1-...
```

## Run

```bash
npm run dev
```

Open http://localhost:5173.

This starts Vite (frontend, :5173) and an Express server (backend, :8787) together. Stop with `Ctrl+C`.

## Using it

1. Choose **New Project** or **Open** on the start screen, then pick an image model and type a sprite prompt in column 1 → **Generate Reference Sprite**.
2. Pick a video model and type a motion prompt in column 2 → **Generate Frames** (calls image-to-video via OpenRouter, polls until done, extracts transparent PNGs).
3. Click frame tiles to toggle which ones to include.
4. **Generate Spritesheet** → composes a 1×N PNG client-side, builds a looping GIF preview server-side.
5. **Export PNG** to download the spritesheet.
6. Use **Add sprite** to expand the collection, **Save project** to save draft edits, and **Close project** to return to the start screen.

Projects live under `~/.ai-game-studio/`, outside the source checkout. Installation creates this directory; the server also creates it if missing. Set `AI_GAME_STUDIO_HOME` to override the storage directory (set it in your shell before installation, or in `.env` for the server).

## Example prompts

### Sprite prompts

- `A pixel-art knight in silver armor with a longsword, side-view, full body, simple flat colors, standing pose`
- `Female ninja with red scarf, dynamic side-view, 2D sprite, anime style`
- `Cute green slime monster, side-view, big eyes, soft shading`
- `Cyberpunk hacker in a hoodie, glowing visor, side-view full body, gritty style`

### Motion prompts

- `Smooth walk cycle, side-view, no head tilting, no camera movement`
- `Sword slash attack, side-view, fast, no shadows`
- `Idle breathing animation, subtle, looping`
- `Jump arc — crouch, leap, mid-air, land`

Tips:
- Keep motion prompts focused on the action. Phrases like *"no camera movement"*, *"side-view"*, and *"no head tilting"* help keep frames game-ready.
- Switching the image model is one entry in `server/image.ts` — see `IMAGE_MODELS`.
- Per-model default durations: Grok Imagine Video = 2 s, MiniMax H3 = 5 s, Seedance 2.0 = 4 s. ~24–30 fps on the source clip, so trim with the frame selector before composing.
- Switching the model is one entry in `server/video.ts` — see `VIDEO_MODELS`.
- Recommend sticking to Grok Imagine Video since it's much cheaper than Seedance 2

## TO-DO

- [ ] Background generation
- [ ] Tilemap generation
- [ ] Aseprite format export
- [ ] Tiled format export
- [ ] SFX generation
- [ ] Music generation
- [ ] Voice generation
- [ ] Full asset scaffolding export

## More

See [AGENTS.md](AGENTS.md) for the full spec, architecture, endpoint list, model-registry pattern, and chroma-key tuning notes.

## Projects and sprites

Use **New project** to create a named collection. The **Sprites** picker above the
builder switches between sprites; **Add sprite** starts another and **Rename**
changes its display name. Each sprite retains its own prompts, models, reference,
selected frames, spritesheet, and GIF. Switching sprites preserves draft prompts
and selections. **Save project** saves the entire collection. Opening or creating
another project first saves the current named collection.

Each saved directory contains a JSON `.project` file:

```json
{
  "version": 1,
  "name": "my-game",
  "activeSpriteId": "sprite-1",
  "sprites": [
    { "id": "sprite-1", "name": "Hero", "path": "sprites/sprite-1/sprite.json" }
  ]
}
```

Sprite artifacts are stored directly in `~/.ai-game-studio/<project>/sprites/<id>/`.
There is no shared working copy or snapshot step. Generated assets and frame
selections persist in place. **Save project**, sprite switching, and closing a
project also save the current draft prompts and model choices. All paths in
`.project` are relative to the project directory. App startup always shows the
start screen; choose **Open** to resume a project.

The previous repository-local `projects/` directory is not modified by this change.

Run persistence regression checks with `node --import tsx --test tests/*.test.ts`.
