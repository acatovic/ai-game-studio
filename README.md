# <img src="wombo-playing.gif" alt="Wombo mascot playing" width="96" height="96"> Wombo — The AI Game Studio

Create characters, animations, and sounds from text prompts. Wombo generates four aligned character views, PNG and Aseprite animations, and MP3/WAV audio. Images and video use OpenRouter; Sound & SFX uses ElevenLabs. All provider calls run on the server.

## Setup and run

Requires Node.js 20+, `ffmpeg`, and `zip` on your PATH.

```bash
npm install
cp .env.example .env
```

Set `OPENROUTER_API_KEY` in `.env` for characters and animations, or `ELEVENLABS_API_KEY` for Sound & SFX. Each workflow only needs its own provider's key.

```bash
npm run dev
```

Open [localhost:5173](http://localhost:5173) and choose **New Project** or **Open**. Projects and generated assets save to `~/.ai-game-studio/` by default. Stop with `Ctrl+C`.

## Documentation

- [Create sprites and animations](docs/create-sprites-and-animations.md)
- [Create music and SFX](docs/create-music-and-sfx.md)
- [Projects, storage, and ZIP import/export](docs/projects-and-storage.md)
- [Demos and After Light showcase](docs/showcase.md)
- [Development instructions](AGENTS.md)
