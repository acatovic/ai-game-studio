# <img src="wombo-playing.gif" alt="Wombo mascot playing" width="96" height="96"> Wombo - The AI Game Studio

Wombo is created with the help of Codex and Astra. It allows you to create named characters, animations, and sounds from text prompts. Generate aligned side, front and back references, then create effectively any animation sequence (e.g. idle, walking, fighting) with automatically saved PNG and Aseprite files. Image and video calls go through OpenRouter; Sound & SFX uses ElevenLabs directly from the server.

## Character creation

Describe your character and generate aligned side, front and back reference views.

Attach an image for visual guidance and describe what to use from it, such as its art style or a specific character. Your text controls the subject and requested changes. Front and back views use the generated side view to keep the new character consistent.

Choose an art style from 8-bit Pixel, Cinematic Pixel, Cel-shaded 2D, or Storybook 3D. The selection is saved per character and carries into animation; Custom lets you describe the style in your own prompt.

![Creating character reference views in Wombo](ai-game-studio-character-angles.gif)

## Animation creation

Turn your character into an animation, choose the frames to include, and save spritesheets as PNG and Aseprite files.

![Creating sprite animations in Wombo](ai-game-studio-sprite-animation.gif)

## Example game: After Light

**After Light** is a 2.5D interplanetary-cyberpunk game currently being built using **Unity + Blender + Astra**, with 2D graphics and sound assets created in Wombo.

![After Light gameplay featuring sprite assets from Wombo](afterlight-demo.gif)

[Play the demo here.](https://acatovic.github.io/afterlight-play/)

## Setup and run

Requires Node.js 20+, `ffmpeg`, and `zip` on your PATH.

```bash
npm install
cp .env.example .env
```

In `.env`, set `OPENROUTER_API_KEY` for characters and animations, and `ELEVENLABS_API_KEY` for Sound & SFX. Each workflow only needs its own provider's key.

```bash
npm run dev
```

Open [localhost:5173](http://localhost:5173). Stop the app with `Ctrl+C`.

## Projects and storage

Choose **New Project** or **Open** on startup. Projects live outside the repository in `~/.ai-game-studio/`; set `AI_GAME_STUDIO_HOME` to use another location. Installation creates the storage directory.

```text
<project>/
├── .project               # Project manifest
├── sprites/<character>/   # References and animations/<animation>/
└── music/<sound>/         # Sound settings and audio revisions
```

Generated assets save automatically. **Save project**, switching assets, and **Close project** persist drafts. Each asset's JSON manifest points to its current files; older generated revisions are retained.

Use **Export** in the project header or beside a saved project in **Open** to download the entire project as a ZIP, including manifests and generated assets. Use **Import** on the start screen or in the header to add an exported project from your computer. Import checks the archive and referenced files before placing it in the storage directory. If a project with the same name exists, choose **Replace project**, **Rename import**, or **Cancel**. Replace deletes the existing project's files after the ZIP passes validation.

## Guides

- [Create sprites and animations](docs/create-sprites-and-animations.md)
- [Create music and SFX](docs/create-music-and-sfx.md)
- [AGENTS.md](AGENTS.md) — architecture, implementation rules, and testing.
