# AI Game Studio

Create named characters and animations from text prompts. Generate a shared character reference, then create walking, idle, and other animations with automatically saved PNG and Aseprite files. Model calls go through OpenRouter.

## Setup

Requires Node.js 20+, `ffmpeg` on your PATH, and an [OpenRouter API key](https://openrouter.ai/keys).

```bash
npm install
cp .env.example .env
```

Set `OPENROUTER_API_KEY` in `.env`, then run:

```bash
npm run dev
```

Open [localhost:5173](http://localhost:5173).

## Create assets

1. Choose **New Project** or **Open**.
2. Click **Add character**, name it (e.g. `scientist-male`), enter a prompt, and click **Generate Character**.
3. Click **Add animation**, name it (e.g. `idle`), describe the motion, and click **Generate Animation**. PNG and Aseprite files save automatically.
4. Toggle frames to refine the animation, then click **Update Spritesheet** to rebuild both files.

Each character can have multiple animations. **Rename** updates folders and filenames. **Save project** saves draft prompts; switching characters, animations, or closing the project also saves drafts.

## Find and view your assets

Projects live in `~/.ai-game-studio/`, outside this repository. Set `AI_GAME_STUDIO_HOME` to use another location.

```text
~/.ai-game-studio/<project>/
└── sprites/scientist-male/
    ├── scientist-male.png          # Character reference
    ├── sprite.json
    └── animations/idle/
        ├── animation.json         # Paths to the current saved files
        ├── preview.gif
        ├── assets/<revision>/
        │   ├── idle.png
        │   └── idle.aseprite
        └── runs/<run>/             # Source video and extracted frames
```

On macOS, press **Cmd+Shift+G** in Finder and enter `~/.ai-game-studio/`.

**To find the current animation files**, open its `animation.json` and look for `spritesheet` and `aseprite`. Those paths are relative to the character folder (`sprites/scientist-male/` in this example). Each update creates a new revision folder; older copies remain and may have different frame counts. Use the manifest paths rather than picking a revision folder at random.

- **In the app:** select the character and animation to view the current spritesheet and looping preview.
- **PNG:** open in an image viewer or import into your game engine. It is a horizontal strip of 128×128 frames.
- **Aseprite:** open in Aseprite to edit the same frames as an animation at approximately 12 fps.

[Watch the demo](https://www.youtube.com/watch?v=MijheSPXnDo). See [AGENTS.md](AGENTS.md) for implementation details.
