# AI Game Studio

Create named characters, animations, and music from text prompts. Generate a shared character reference, then create walking, idle, and other animations with automatically saved PNG and Aseprite files. Compose short music cues and looping background tracks in the same project. Model calls go through OpenRouter.

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

## Create music

1. Open a project, choose **Music**, and click **Add music** to name a track.
2. Describe the scene, mood, instruments, tempo, and key. The server requests instrumental music without vocals.
3. Enable **Looping** for a loop, or leave it off for a short clip. **Length (seconds)** defaults to 30 and accepts whole numbers from 30 to 90 in either mode. Invalid values show an inline error.
4. Click **Generate Music**. Google Lyria 3 Pro (`google/lyria-3-pro-preview`) is the default. A bouncing headphone character and cycling dots indicate generation is in progress. The original MP3 and a 48 kHz stereo, 16-bit PCM WAV save automatically.
5. Play the WAV in the preview. For a loop, **Test Loop** starts three seconds before the end and repeats with Web Audio buffer playback.

Tracks have independent prompts, settings, and outputs. Save, track switching, workspace switching, and Close project persist drafts. Rename moves the folder and updates the current WAV filename. Editing settings does not change an existing recording until you generate again.

### Duration and looping

OpenRouter's [audio generation guide](https://openrouter.ai/docs/guides/overview/multimodal/audio) uses streamed chat completions with `modalities: ["text", "audio"]` and `delta.audio.data`. The integration requests MP3 without a speech voice, using the [Lyria 3 Pro model](https://openrouter.ai/google/lyria-3-pro-preview?view=api). No undocumented numeric duration or loop parameter is sent.

Duration is requested in the prompt, then enforced locally with ffmpeg decoding and PCM trimming. The prompt asks for a small amount of extra audio. A recording shorter than the required length fails with a useful error and preserves the previous output.

Loop mode requests a repeating phrase with steady tempo and no intro or outro. A one-second circular crossfade blends the tail into the head, consuming one extra second of source audio while retaining the selected output duration. PCM WAV avoids MP3 encoder padding at the playback boundary. This smooths the waveform transition; it cannot guarantee a beat- or harmony-matched musical loop. Listen to the join and refine the prompt or regenerate when necessary.

Short clips receive 30 ms edge fades. All post-processing is local; model requests go only through the server to OpenRouter.

```text
~/.ai-game-studio/<project>/
├── .project                       # Characters and music track entries
├── sprites/...
└── music/forest/
    ├── music.json                 # Draft settings + committed output metadata
    └── revisions/<revision>/
        ├── source.mp3             # Original model output
        └── forest.wav             # Prepared game asset
```

The current files are identified by `output.audio` and `output.source` in `music.json`; paths are relative to the track folder. Each generation writes a new revision and commits the manifest only after the WAV is ready. Older successful revisions remain available.

Music routes are `GET /api/models/music`, `GET /api/music`, and `POST /api/music/{new,load,rename,draft,generate}`. Requests use `X-Project-Name`; draft, generation, and rename also require `X-Music-Id`, so another tab's active track cannot redirect a write. Music can be created in projects with no characters.

Run `npm run build` and `node --import tsx --test tests/*.test.ts` to validate changes. Automated music tests use a mocked OpenRouter stream and real local audio processing; they do not incur model charges.

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
