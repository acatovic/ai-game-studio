# AI Game Studio

Create named characters, animations, and sounds from text prompts. Generate aligned side, front and back references, then create walking, idle and transition animations with automatically saved PNG and Aseprite files. Image and video calls go through OpenRouter; Sound & SFX uses ElevenLabs directly from the server.

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
2. Click **Add character**, name it (e.g. `scientist-male`), enter a prompt, and click **Generate Character**. Switch between **Side →**, **Front** and **Back** in the reference preview.
3. Click **Add animation**, name it (e.g. `idle`), describe the motion, optionally choose start/end images, and click **Generate Animation**. PNG and Aseprite files save automatically.
4. Toggle frames to refine the animation, then click **Update Spritesheet** to rebuild both files.

Each character can have multiple animations. **Rename** updates folders and filenames. **Save project** saves draft prompts; switching characters, animations, or closing the project also saves drafts.

Select an animation and click **Duplicate** to create an independent copy, such as `idle-2`. The new animation keeps the current prompt, model, frame selection, source clips, and generated outputs, and opens automatically so you can edit it.

The **bin button** deletes the selected animation or sound after confirmation, including its generated files. Another item is selected automatically; deleting the last item returns that section to its empty state.

Choose **MiniMax H3 Max** in the animation model selector to generate 5-second clips at 480p through OpenRouter.

### Reference views and transitions

Character generation makes three image requests: a side view facing right, then front and back views guided by that same side image. Processing removes the reserved chroma background and fits each silhouette to a 1024×1024 transparent canvas with identical character height, horizontal center and baseline, preserving each view's proportions. Very wide characters share a smaller height so no view clips. Invalid, empty or clipped images fail the whole operation; the previous reference set and animations remain intact. Model-generated anatomy and costume details can still vary and should be reviewed using the tabs.

**Start image** and **End image** offer all available character references and each animation's first/last **included** frame, in chronological order. **None** leaves the start pose unconstrained and sends no first-frame image. With both endpoints unset, generation requests a seamless loop and uses the side reference for appearance guidance; H3 Max instead uses the character and movement prompts because it has no reference-only mode. With an end image, it requests a transition to that pose, without adding an implicit start frame.

For example, `turn-north` can start with `idle-side · last included frame` and end with **Back reference**. Then `step-back` can start with `turn-north · last included frame` and end with `idle-side · first included frame`.

Selected poses are copied into the target animation when its draft is saved, including on navigation and generation. They survive changes, regeneration, rename and deletion of their source. After a source changes, the picker keeps the previous selection under **Saved pose** and offers its latest frame separately. Duplicating an animation copies these inputs too. Clearing a selection and saving removes that endpoint. Endpoint images are fitted to a shared square canvas before video submission; the provider controls how closely the generated motion matches them.

Grok supports a start image only. **MiniMax H3 Max accepts one keyframe per request: either a start image or an end image. MiniMax H3 and Seedance accept both together.** The UI prevents unsupported combinations and explains which model to choose; the server rejects them before calling OpenRouter. Existing selected poses are retained so you can switch models or clear one endpoint.

Requests use OpenRouter's `frame_images` with explicit `first_frame` / `last_frame` roles, never two unordered style references. Model capabilities in `server/video.ts` declare supported endpoint types separately from `maxKeyframeImages`. OpenRouter's model catalogue lists both frame types for H3 Max, but that does not establish that both can be combined; its live route rejects paired keyframes. These limits apply to the OpenRouter route used by this app.

Existing single-reference characters open with their original image in **Side →**. Generate Character to add the full aligned set; old files and existing animations are preserved. Character manifests remain version 2 with optional `referenceViews` and `referenceAlignment`. Animation manifests add optional `startImage` / `endImage` records containing source labels and character-relative snapshot paths.

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
    ├── sprite.json
    ├── references/<revision>/
    │   ├── side.png               # Aligned character views
    │   ├── front.png
    │   ├── back.png
    │   └── *-original.png         # Original provider images
    └── animations/idle/
        ├── animation.json         # Paths to the current saved files
        ├── inputs/<id>.png        # Saved start/end poses
        ├── preview.gif
        ├── assets/<revision>/
        │   ├── idle.png
        │   └── idle.aseprite
        └── runs/<run>/             # Source video and extracted frames
```

On macOS, press **Cmd+Shift+G** in Finder and enter `~/.ai-game-studio/`.

The `sprite.json` manifest's `referenceViews` identifies the current set; its `sprite` field remains a compatible alias for the side view. Each generation stages all views in one isolated revision and publishes them together.

**To find the current animation files**, open its `animation.json` and look for `spritesheet` and `aseprite`. Those paths are relative to the character folder (`sprites/scientist-male/` in this example). Each update creates a new revision folder; older copies remain and may have different frame counts. Use the manifest paths rather than picking a revision folder at random.

- **In the app:** select the character and animation to view the current spritesheet and looping preview.
- **PNG:** open in an image viewer or import into your game engine. It is a horizontal strip of 128×128 frames.
- **Aseprite:** open in Aseprite to edit the same frames as an animation at approximately 12 fps.

[Watch the demo](https://www.youtube.com/watch?v=MijheSPXnDo). See [AGENTS.md](AGENTS.md) for implementation details.

Character and transition tests use synthetic OpenRouter responses and real local image/video processing; they do not incur provider charges. Run the build and full test suite before shipping.
