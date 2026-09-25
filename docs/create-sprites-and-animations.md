# Create sprites and animations

Use **Characters & Animations** to create a character, generate its reference views, and build named animations. Complete the [setup](../README.md#setup-and-run) with an `OPENROUTER_API_KEY` before generating.

## Create a character

1. Choose **New Project** or **Open**. New projects start with no characters.
2. Select **Characters & Animations**, click **Add character**, and enter a name such as `scientist-male`.
3. Pick an **Art style** from the four presets, or leave **Custom** to describe the style yourself. Describe the character's appearance in **Character Prompt** and choose an image model.
4. Click **Generate Character**, then review **Side**, **Front**, and **Back**.

For example:

> A pixel-art scientist wearing a white lab coat, dark trousers, brown boots, and round glasses. Full body, neutral standing pose, consistent proportions.

Generation creates a side view facing right, then uses that image to guide the front and back views. All three are aligned on transparent 1024×1024 canvases with a shared character height, horizontal center, and baseline. Wide characters are scaled to fit without clipping. The app reserves chroma green for background removal, so avoid green clothing or accessories.

The art style library offers **8-bit Pixel**, **Cinematic Pixel** (the After Light direction), **Cel-shaded 2D**, and **Storybook 3D**. A preset adds rendering instructions when generating; it does not replace or rewrite the visible character prompt. Each character remembers its selection. Existing characters start on Custom, preserving their original prompts and references.

Changing the selection leaves existing references as they are until you click **Generate Character** again. The picker shows a reminder when a change is pending. Animations follow the style of the saved reference views, and 2D cel-shaded and 3D styles use smooth spritesheet scaling while pixel styles keep crisp nearest-neighbor scaling. A prompt guides the model toward low-resolution pixel art, but does not enforce a fixed pixel grid or exact palette.

Review all views for consistent anatomy and costume details. Regenerating replaces the current reference set together and keeps existing animations and original images. If a view fails generation or alignment, the previous set remains available.

Older characters with a single reference show it under **Side**. Generate the character again to add the full set.

## Create an animation

1. Click **Add animation** and name it, for example `idle`, `walk`, or `turn-north`.
2. Enter a **Movement Prompt** describing the action, direction, and pace.
3. Choose a video model and optionally select **Start image** and **End image**.
4. Click **Generate Animation** and wait for the frames and saved outputs.

Example movement prompt:

> Slow idle breathing with subtle movement in the hair and arms. Remain centered and fully visible, with no panning, zoom, or other motion.

The app generates a video, removes its chroma background, and extracts transparent frames. All frames are initially included. It automatically saves a PNG spritesheet and matching Aseprite animation, then builds a looping preview.

### Model settings

These are the settings supported by the app's OpenRouter routes:

| Model | Default clip length | Start/end images |
| --- | --- | --- |
| Grok Imagine Video | 2 seconds | Start only |
| MiniMax H3 | 5 seconds | Start, end, or both |
| MiniMax H3 Max | 5 seconds, 480p | Start only |
| Seedance 2.0 | 4 seconds | Start, end, or both |

If a selected model cannot accept your endpoint combination, switch models or clear an endpoint. The app keeps your selections when switching models.

H3 Max's current OpenRouter route rejects two keyframes, and MiniMax rejects an end frame without a start frame. Although OpenRouter lists both frame types, this combination of restrictions makes end images unusable on that route (checked September 14, 2026). Use MiniMax H3 or Seedance when selecting an end image.

## Connect animations with saved poses

The start and end image pickers offer:

- **Side**, **Front**, and **Back** references.
- The **first included frame** and **last included frame** of any animation in the same character, ordered chronologically.
- A previously selected **Saved pose** when its source has since changed.

**Start image: None** leaves the starting pose unconstrained. **End image: None** requests a seamless cycle with matching starting and ending poses. Choosing an end image requests a transition that finishes in that pose; an end-only request does not add an implicit start image.

With neither endpoint selected, the app uses the side reference for appearance guidance where supported. MiniMax H3 Max uses the character and movement prompts instead.

For a turn followed by a step:

1. Create `turn-north`, starting with `idle · last included frame` and ending with **Back**.
2. Create `step-back`, starting with `turn-north · last included frame`.
3. Select an end pose if you need the step to finish in a particular position, using a model that supports both endpoints.

Selected images are copied into the target animation when you save, navigate, or generate. These snapshots survive regeneration, renaming, and deletion of the source. A changed source appears as a new choice while the saved pose remains selected. Clear an endpoint and save to remove it.

## Refine and manage animations

Click frame tiles to include or exclude them, then click **Update Spritesheet** in column 3 to rebuild the PNG, Aseprite, and preview. Frame selection saves automatically, but the generated files only reflect a changed selection after this update. Keep at least one frame selected.

The **Frame size** picker above that button expands into **64×64**, **128×128** (default), and **256×256** options. Size belongs to each animation and is saved with its draft on Save, navigation, and Close. After changing it, click **Update Spritesheet** to apply the size to both output formats and the animated preview. The size is applied during composition, preserving proportions and transparent padding. References, source video, and extracted frames stay at their working resolutions, so resizing requires no new generation or extraction. The output caption shows the saved size until the update succeeds.

- **Rename** updates the character or animation folder and affected asset paths.
- **Duplicate** creates an independent animation with its prompts, model, saved poses, frame selection, frame size, source clips, and outputs.
- Character, animation, and sound actions appear in the order **Add**, **Rename**, **Delete**. Animation **Duplicate** follows these actions.
- The character **bin button** deletes the selected character, its references, and all of its animations and files.
- The animation **bin button** deletes the selected animation and its generated files. Both deletion dialogs name the item and offer **Yes** / **No**; **No** or Escape cancels.
- **Save project**, navigation between assets or workspaces, and **Close project** save draft prompts and selections. Closing returns to the start screen.

Each character can have multiple animations. Editing prompts or poses changes the next generation; it does not regenerate existing frames.

The **Background** bubble below **Spritesheet Preview** expands into swatches for transparency, mid-tone gray, deep blue-gray, chroma key green, magenta, and off-white. A colour changes the backdrop behind both the spritesheet and animated preview; saved PNG and Aseprite files retain their transparency.

## Find the generated files

By default:

```text
~/.ai-game-studio/<project>/
└── sprites/<character>/
    ├── sprite.json
    ├── references/<revision>/
    │   ├── side.png
    │   ├── front.png
    │   ├── back.png
    │   └── *-original.png
    └── animations/<animation>/
        ├── animation.json
        ├── inputs/<id>.png
        ├── assets/<revision>/
        │   ├── <animation>.png
        │   ├── <animation>.aseprite
        │   └── preview.gif
        └── runs/<run>/
            ├── source.mp4
            └── frames/
```

`AI_GAME_STUDIO_HOME` overrides the storage root. On macOS, press **Cmd+Shift+G** in Finder and enter `~/.ai-game-studio/`.

`sprite.json` identifies the current reference views. To find an animation's current output, open its `animation.json` and follow `spritesheet`, `aseprite`, and `previewGif`. These paths are relative to the character folder. Older revisions remain on disk, so use the manifest rather than choosing a revision folder by its name.

The PNG is a horizontal strip of **64×64**, **128×128**, or **256×256 frames**, according to the animation's frame size. The Aseprite file contains the same frames at approximately **12 fps**. Import the PNG into your game engine or open the Aseprite file to edit it. Fine reference details may simplify when reduced to the output size.

## Troubleshooting

- **Missing key:** set `OPENROUTER_API_KEY` in `.env` and restart the app.
- **Image, video, or GIF processing fails:** check that `ffmpeg` is installed and available on your PATH.
- **A reference fails alignment:** request the full character with clear space around it and retry.
- **PNG and Aseprite save but the animated preview fails:** fix the processing issue and click **Update Spritesheet** to rebuild the preview.

See [AGENTS.md](../AGENTS.md) for implementation details and testing instructions, or return to the [README](../README.md).
