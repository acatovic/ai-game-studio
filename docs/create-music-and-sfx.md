# Create music and SFX

Use **Sound & SFX** for short soundtracks, ambient loops, and individual sound effects. This workspace uses **ElevenLabs Sound Effects v2** directly from the server. Complete the [setup](../README.md#setup-and-run) with an `ELEVENLABS_API_KEY`; sound generation does not require an OpenRouter key.

## Create a sound

1. Choose **New Project** or **Open**, then select **Sound & SFX**.
2. Click **Add sound** and enter a name such as `forest-ambience`, `door-creak`, or `menu-theme`.
3. Describe the sound in **Sound Prompt**.
4. Choose the length and whether it should loop.
5. Click **Generate Sound**. Wait for the saved sound to appear in **Sound Preview**, then play it.

Describe the event, texture, pace, and environment. Examples:

- **Effect:** “A single heavy wooden door slowly creaks open, ending with a soft latch click. Close and dry, with no background ambience.”
- **Ambient loop:** “Steady rain in a quiet forest, soft wind through leaves, and occasional distant thunder.”
- **Short soundtrack:** “A gentle fantasy menu theme with soft bells and warm strings, calm and unhurried.”

Each named sound has its own prompt, settings, and recording. Sounds belong to the project, so you can create them without adding a character.

## Choose the length

**Auto length** is enabled by default and lets ElevenLabs choose a duration from your prompt.

Turn Auto off to enter a duration from **0.5 to 30 seconds**, including decimals. Invalid values show an inline error and prevent generation.

The preview shows the recording's actual decoded length, which is saved separately from the requested duration. Changing the length setting affects the next generation; it does not trim the current recording.

## Generate and test loops

Enable **Looping** before generation to request a loop from ElevenLabs. Leave it off for one-shot sounds such as footsteps, impacts, or doors.

For a generated loop, click **Test Loop**. Playback starts near the end of the recording and continues through the beginning so you can hear the join. Click **Stop Test** to stop.

Looping uses the provider's native loop setting. The app converts the recording to WAV without local crossfades, trimming, or edge fades. If the join is noticeable, refine the prompt and generate again. Turning Looping on after generation does not convert the saved recording into a loop.

## Save and manage sounds

The original MP3 and a **48 kHz stereo, 16-bit PCM WAV** save automatically after successful generation. The WAV keeps the full decoded recording, including the attack and tail of a sound effect.

- **Save project**, switching sounds or workspaces, and **Close project** persist draft settings.
- **Rename** moves the sound's folder and renames the current WAV.
- The **bin button** deletes the selected sound and its audio files after confirmation.
- Regeneration creates a separate revision. A failed generation or audio conversion preserves the previous saved recording.

Prompt, length, and loop edits apply when you next click **Generate Sound**. Until then, playback uses the existing recording.

## Find the generated files

Sound assets use the `music` folder name for compatibility with existing projects:

```text
~/.ai-game-studio/<project>/
├── .project
└── music/<sound>/
    ├── music.json
    └── revisions/<revision>/
        ├── source.mp3
        └── <sound>.wav
```

`AI_GAME_STUDIO_HOME` overrides the storage root. On macOS, press **Cmd+Shift+G** in Finder and enter `~/.ai-game-studio/`.

Open `music.json` and follow `output.audio` for the current WAV or `output.source` for the original recording. Both paths are relative to the sound's folder. Older successful revisions remain available; use the manifest to identify the current files.

Import the WAV into your game engine or audio editor. You can also listen to it directly in the app.

## Open older music projects

Existing Lyria recordings and their output metadata remain intact and playable. When opened, their draft settings switch to ElevenLabs; requested lengths over 30 seconds become Auto. This affects future generation only and does not shorten or regenerate existing audio.

## Troubleshooting

- **Missing key:** set `ELEVENLABS_API_KEY` in `.env` and restart the app. An OpenRouter key does not enable this workspace.
- **Invalid length:** enable Auto or enter a number between 0.5 and 30.
- **Audio conversion fails:** check that `ffmpeg` is installed and available on your PATH.
- **Generation fails or times out:** review the inline error and retry; the previous saved output remains available.

See [AGENTS.md](../AGENTS.md) for implementation details and testing instructions, or return to the [README](../README.md).
