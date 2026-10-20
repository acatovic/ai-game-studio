# Projects and storage

Choose **New Project** or **Open** on startup. Projects live outside the repository in `~/.ai-game-studio/`; set `AI_GAME_STUDIO_HOME` to use another location. Installation creates the storage directory.

```text
<project>/
├── .project               # Project manifest
├── sprites/<character>/   # References and animations/<animation>/
└── music/<sound>/         # Sound settings and audio revisions
```

Generated assets save automatically. **Save project**, switching assets, and **Close project** persist drafts. Each asset's JSON manifest points to its current files; older generated revisions are retained.

Every animation has an `assets/latest/` folder containing `<animation>.png` and `<animation>.aseprite`, copied from the files selected by `animation.json`. It is empty until output is generated. Generation, spritesheet updates, rename, and duplicate keep these convenient copies in sync. Opening an existing project also refreshes them. To backfill all stored animations without changing their manifests, run `npm run backfill:animation-latest`.

Use **Export** in the project header or beside a saved project in **Open** to download the entire project as a ZIP, including manifests and generated assets. Use **Import** on the start screen or in the header to add an exported project from your computer. Import checks the archive and referenced files before placing it in the storage directory. If a project with the same name exists, choose **Replace project**, **Rename import**, or **Cancel**. Replace deletes the existing project's files after the ZIP passes validation.

See the [sprite and animation guide](create-sprites-and-animations.md) and [sound guide](create-music-and-sfx.md) for individual asset workflows.
