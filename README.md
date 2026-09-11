# AI Game Studio

Create named characters, animations, and sounds from text prompts. Generate a shared character reference, then create walking, idle, and other animations with automatically saved PNG and Aseprite files. Compose short music cues and looping background tracks in the same project. Image and video calls go through OpenRouter; Sound & SFX uses ElevenLabs directly from the server.

## Setup

Requires Node.js 20+, `ffmpeg` on your PATH, an [OpenRouter API key](https://openrouter.ai/keys) for characters/animations, and an ElevenLabs API key for Sound & SFX.

```bash
npm install
cp .env.example .env
```

Set `OPENROUTER_API_KEY` and `ELEVENLABS_API_KEY` in `.env`, then run:

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

## Create Sound & SFX

1. Open a project, choose **Sound & SFX**, and click **Add sound**.
2. Describe a short soundtrack, ambient soundscape, or isolated effect: footsteps on gravel, a wooden door creaking, an impact, or a looping rainy forest. Your prompt is sent directly to ElevenLabs without music-only instructions.
3. Leave **Auto length** enabled to let ElevenLabs infer duration from the prompt, or turn it off and enter **0.5–30 seconds**, including decimals. Invalid values show an inline error.
4. Enable **Looping** to request a native loop, then click **Generate Sound**. A bouncing headphone character and cycling dots show generation is in progress.
5. Play the saved WAV, or use **Test Loop** to listen across the end/start boundary.

The server calls the [ElevenLabs sound-effect API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) with `model_id: "eleven_text_to_sound_v2"`, `text`, `loop`, and `duration_seconds`. Auto is stored as `duration: null` in the draft and output settings and passed as `duration_seconds: null`; it is never replaced with a fixed duration. The actual decoded length is saved separately as `output.actualDuration` and displayed in the preview.

The original MP3 and a decoded 48 kHz stereo, 16-bit PCM WAV save automatically. The WAV preserves the full decoded waveform: there is no local crossfade, trimming, or edge fade to alter provider loops or soften short SFX attacks. Listen to the result before using it in your game.

Sounds have independent prompts, settings, and outputs. Save, switching assets/workspaces, and Close project persist drafts. Rename moves the folder and renames the current WAV. Each generation writes an isolated revision; failed calls or processing preserve the previous recording.

### Existing projects and storage

For compatibility, Sound & SFX retains the existing `music` storage fields, directories, and API routes. Existing Lyria recordings and their metadata remain intact and playable. Their draft model changes to ElevenLabs when opened; lengths over 30 seconds become Auto for the next generation. This does not shorten or regenerate existing audio.

```text
~/.ai-game-studio/<project>/
├── .project
├── sprites/...
└── music/door/
    ├── music.json
    └── revisions/<revision>/
        ├── source.mp3
        └── door.wav
```

`output.audio` and `output.source` in `music.json` identify the current files, relative to the asset's folder. Older successful revisions remain available. Requests use `X-Project-Name`; draft, generation, and rename also require `X-Music-Id`, so another tab's selected sound cannot redirect a write.

Routes remain `GET /api/models/music`, `GET /api/music`, and `POST /api/music/{new,load,rename,draft,generate}`. The model-list response reports ElevenLabs key availability; health reports `hasApiKey` for OpenRouter and `hasElevenLabsApiKey` for sounds. Either workflow can operate without the other provider's key. Keys stay on the server and are redacted from provider errors.

Run `npm run build` and `node --import tsx --test tests/*.test.ts`. Sound tests mock ElevenLabs responses and use real local audio processing; they do not incur model charges.

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
