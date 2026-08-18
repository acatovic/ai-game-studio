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

1. Pick an image model and type a sprite prompt in column 1 → **Generate Reference Sprite**.
2. Pick a video model and type a motion prompt in column 2 → **Generate Frames** (calls image-to-video via OpenRouter, polls until done, extracts transparent PNGs).
3. Click frame tiles to toggle which ones to include.
4. **Generate Spritesheet** → composes a 1×N PNG client-side, builds a looping GIF preview server-side.
5. **Export PNG** to download the spritesheet.
6. Header: **New** to start fresh, **Save** to name and snapshot the current project, **Load** to switch to a saved one.

Generated artifacts live under `projects/` (gitignored). The current working state is always in `projects/latest/`.

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
