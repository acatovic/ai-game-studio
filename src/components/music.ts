import { trashIcon } from "./icons";

interface MusicSettings { prompt: string; model: string; duration: number | null; loop: boolean }
interface MusicTrack extends MusicSettings {
  id: string;
  name: string;
  audioUrl: string | null;
  output: (MusicSettings & { createdAt: string; crossfadeSeconds: number; actualDuration?: number }) | null;
}
interface MusicView {
  tracks: { id: string; name: string }[];
  activeMusicId: string;
  track: MusicTrack | null;
}

export function mountMusic(root: HTMLElement, setWorking: (busy: boolean) => void,
  askName: (title: string, initial?: string) => Promise<string | null>) {
  root.innerHTML = `
    <nav class="sprite-toolbar" aria-label="Project sounds">
      <label for="music-picker">Sounds & SFX</label>
      <select id="music-picker" class="select" aria-label="Sound"></select>
      <button id="music-add" class="btn btn--secondary btn--sm" type="button">+ Add sound</button>
      <button id="music-rename" class="btn btn--secondary btn--sm" type="button">Rename</button>
      <button id="music-delete" class="btn btn--secondary btn--sm" type="button" title="Delete sound" aria-label="Delete sound">${trashIcon}</button>
      <span>Soundtracks and short effects, saved alongside your characters</span>
    </nav>
    <p id="music-empty" class="asset-empty">Add a sound to create a short soundtrack, ambient loop, or sound effect.</p>
    <div id="music-fields" class="columns" hidden>
      <section class="card">
        <h2 class="card__title">1. Describe Sound & SFX</h2>
        <div class="field">
          <label class="field__label" for="music-prompt">Sound Prompt</label>
          <textarea id="music-prompt" class="textarea" rows="8" maxlength="20000"
            placeholder="e.g. A rainy forest soundscape with distant thunder, or a single heavy wooden door creaking open."></textarea>
        </div>
        <p class="asset-save-note">Create short soundtracks, ambient soundscapes, footsteps, impacts, doors, and other SFX. Describe what happens, the texture, and the environment.</p>
        <div class="field">
          <label class="field__label" for="music-model">Model</label>
          <select id="music-model" class="select"></select>
        </div>
      </section>
      <section class="card">
        <h2 class="card__title">2. Clip Settings</h2>
        <div class="field">
          <button id="music-mode" class="music-toggle" type="button" aria-pressed="false">
            <span class="music-toggle__indicator" aria-hidden="true"></span>
            Looping <span id="music-loop-state">Off</span>
          </button>
        </div>
        <div class="field">
          <label class="field__label" for="music-duration">Length (seconds)</label>
          <button id="sound-auto" class="music-toggle" type="button" aria-pressed="true">Auto length <span id="sound-auto-state">On</span></button>
          <input id="music-duration" class="input" type="number" min="0.5" max="30" step="any" value="5" required aria-describedby="sound-length-note music-length-error" />
          <p id="sound-length-note" class="asset-save-note">Auto lets ElevenLabs choose a length from your prompt. Turn it off to choose 0.5–30 seconds.</p>
          <p id="music-length-error" class="field-error" aria-live="polite" hidden></p>
        </div>
        <p id="music-mode-note" class="asset-save-note"></p>
        <button id="music-generate" class="btn btn--primary btn--block" type="button">Generate Sound</button>
        <div id="music-loading" class="music-loading" hidden aria-hidden="true">
          <svg class="music-loading__character" viewBox="0 0 96 96" fill="none">
            <ellipse class="music-loading__shadow" cx="48" cy="84" rx="23" ry="5" fill="currentColor" opacity=".15" />
            <g class="music-loading__bounce">
              <path d="M24 65C18 39 27 22 48 22s30 17 24 43l-7 9-10-4-7 5-7-5-10 4z" fill="currentColor" />
              <path d="M24 47v-6a24 24 0 0 1 48 0v6" stroke="#1e293b" stroke-width="6" stroke-linecap="round" />
              <rect x="17" y="43" width="11" height="19" rx="5" fill="#1e293b" />
              <rect x="68" y="43" width="11" height="19" rx="5" fill="#1e293b" />
              <ellipse cx="38" cy="47" rx="3" ry="4" fill="white" />
              <ellipse cx="58" cy="47" rx="3" ry="4" fill="white" />
              <path d="M42 58q6 7 12 0" stroke="white" stroke-width="3" stroke-linecap="round" />
            </g>
          </svg>
          <span>Creating<span class="music-loading__dots"><span>.</span><span>.</span><span>.</span></span></span>
        </div>
        <p id="music-status" class="status" role="status" aria-live="polite"></p>
      </section>
      <section class="card">
        <h2 class="card__title">3. Sound Preview</h2>
        <div class="music-art" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></div>
        <p id="music-output-meta" class="sheet-footer__meta">No sound generated yet</p>
        <audio id="music-audio" controls preload="metadata" hidden></audio>
        <button id="music-audition" class="btn btn--secondary" type="button" hidden>Test Loop</button>
        <p id="music-playback-status" class="status" role="status"></p>
        <p class="asset-save-note">Your WAV and original audio are saved automatically inside this project. Prompt and settings changes apply on the next generation.</p>
      </section>
    </div>
    <p id="music-global-status" class="status" role="status"></p>`;
  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const picker = el<HTMLSelectElement>("music-picker");
  const prompt = el<HTMLTextAreaElement>("music-prompt");
  const model = el<HTMLSelectElement>("music-model");
  const mode = el<HTMLButtonElement>("music-mode");
  const duration = el<HTMLInputElement>("music-duration");
  const auto = el<HTMLButtonElement>("sound-auto");
  let autoLength = true;
  let hasApiKey = false;
  const lengthError = el<HTMLElement>("music-length-error");
  const loading = el<HTMLElement>("music-loading");
  let loopEnabled = false;
  const generate = el<HTMLButtonElement>("music-generate");
  const add = el<HTMLButtonElement>("music-add");
  const rename = el<HTMLButtonElement>("music-rename");
  const remove = el<HTMLButtonElement>("music-delete");
  const audio = el<HTMLAudioElement>("music-audio");
  const audition = el<HTMLButtonElement>("music-audition");
  const status = el<HTMLElement>("music-status");
  const globalStatus = el<HTMLElement>("music-global-status");
  const playbackStatus = el<HTMLElement>("music-playback-status");
  let project: string | null = null;
  let view: MusicView = { tracks: [], activeMusicId: "", track: null };
  let dirty = false;
  let externalBusy = false;
  let working = false;
  let modelsLoaded = false;
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let playbackRevision = 0;
  let loadingAudio = false;

  function stopPlayback() {
    playbackRevision++;
    loadingAudio = false;
    source?.stop();
    source = undefined;
    audio.pause();
    audition.textContent = "Test Loop";
    playbackStatus.textContent = "";
  }
  async function request<T>(route: string, body?: unknown): Promise<T> {
    if (!project) throw new Error("Open a project first");
    const response = await fetch(route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json", "X-Project-Name": project,
        ...(view.activeMusicId ? { "X-Music-Id": view.activeMusicId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
    return json as T;
  }
  function settings(): MusicSettings {
    return { prompt: prompt.value, model: model.value, duration: autoLength ? null : Number(duration.value), loop: loopEnabled };
  }
  function updateDisabled() {
    const busy = externalBusy || working;
    const hasTrack = !!view.track;
    for (const input of [picker, prompt, model, mode, auto, duration, generate, rename, remove]) input.disabled = busy || !hasTrack;
    duration.disabled ||= autoLength;
    duration.hidden = autoLength;
    add.disabled = busy || !project;
    generate.disabled ||= !modelsLoaded || !hasApiKey || !validLength();
    audition.disabled = busy || loadingAudio;
  }
  function validLength(): boolean {
    return autoLength || (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(duration.value)
      && Number.isFinite(duration.valueAsNumber) && duration.valueAsNumber >= 0.5 && duration.valueAsNumber <= 30);
  }
  function validateLength(): boolean {
    const valid = validLength();
    lengthError.hidden = valid;
    lengthError.textContent = valid ? "" : "Invalid length. Enter a number from 0.5 to 30 seconds, or enable Auto length.";
    duration.setAttribute("aria-invalid", String(!valid));
    updateDisabled();
    return valid;
  }
  function updateMode() {
    mode.setAttribute("aria-pressed", String(loopEnabled));
    el("music-loop-state").textContent = loopEnabled ? "On" : "Off";
    el("music-mode-note").textContent = loopEnabled
      ? "ElevenLabs will generate a looping sound. Use Test Loop to listen across the join."
      : "Create a short soundtrack, soundscape, or a single effect. The original attack and tail are preserved.";
    auto.setAttribute("aria-pressed", String(autoLength));
    el("sound-auto-state").textContent = autoLength ? "On" : "Off";
  }
  function apply(next: MusicView) {
    stopPlayback();
    view = next;
    dirty = false;
    picker.replaceChildren(...next.tracks.map(track => new Option(track.name, track.id)));
    picker.value = next.activeMusicId;
    picker.hidden = rename.hidden = remove.hidden = !next.track;
    el("music-fields").hidden = !next.track;
    el("music-empty").hidden = !!next.track;
    status.textContent = "";
    globalStatus.textContent = hasApiKey || !project ? "" : "ELEVENLABS_API_KEY is missing. Add it to .env and restart the server.";
    globalStatus.className = "status" + (!hasApiKey && project ? " status--error" : "");
    prompt.value = next.track?.prompt ?? "";
    model.value = next.track?.model ?? "";
    loopEnabled = next.track?.loop ?? false;
    autoLength = next.track?.duration == null;
    duration.value = String(next.track?.duration ?? 5);
    updateMode();
    validateLength();
    audio.hidden = !next.track?.audioUrl;
    if (next.track?.audioUrl) audio.src = next.track.audioUrl + "?v=" + encodeURIComponent(next.track.output!.createdAt);
    else { audio.removeAttribute("src"); audio.load(); }
    audition.hidden = !next.track?.output?.loop;
    el("music-output-meta").textContent = next.track?.output
      ? `${next.track.name}.wav · ${(next.track.output.actualDuration ?? next.track.output.duration ?? 0).toFixed(2).replace(/\.?0+$/, "")}s · ${next.track.output.loop ? "Loop" : "Sound effect / track"} · 48 kHz stereo`
      : "No sound generated yet";
    updateDisabled();
  }
  async function persist() {
    if (!project || !view.track || !dirty) return;
    if (!validateLength()) throw new Error(lengthError.textContent!);
    await request("/api/music/draft", settings());
    dirty = false;
  }
  async function run(action: () => Promise<void>) {
    if (working || externalBusy) return;
    working = true;
    setWorking(true);
    updateDisabled();
    try { await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Could not update sound";
      status.textContent = message;
      status.className = "status status--error";
      globalStatus.textContent = view.track ? "" : message;
      globalStatus.className = "status status--error";
    } finally { working = false; setWorking(false); updateDisabled(); }
  }
  prompt.addEventListener("input", () => { dirty = true; });
  model.addEventListener("change", () => { dirty = true; });
  duration.addEventListener("input", () => { dirty = true; validateLength(); });
  mode.addEventListener("click", () => {
    dirty = true;
    loopEnabled = !loopEnabled;
    updateMode();
  });
  auto.addEventListener("click", () => {
    dirty = true;
    autoLength = !autoLength;
    updateMode();
    validateLength();
  });
  picker.addEventListener("change", () => {
    const id = picker.value;
    void run(async () => {
      try { await persist(); apply(await request("/api/music/load", { value: id })); }
      finally { picker.value = view.activeMusicId; }
    });
  });
  for (const [button, action] of [[add, "new"], [rename, "rename"]] as const) {
    button.addEventListener("click", () => void run(async () => {
      const name = await askName(action === "new" ? "Add sound" : "Rename sound", action === "rename" ? view.track?.name : "");
      if (!name) return;
      await persist();
      apply(await request(`/api/music/${action}`, { value: name }));
    }));
  }
  remove.addEventListener("click", () => void run(async () => {
    const track = view.track;
    if (!track || !window.confirm(`Delete sound '${track.name}' and all its audio files? This can't be undone.`)) return;
    stopPlayback();
    apply(await request("/api/music/delete", {}));
  }));
  generate.addEventListener("click", () => void run(async () => {
    if (!prompt.value.trim()) throw new Error("Describe the sound first.");
    await persist();
    stopPlayback();
    status.className = "status";
    status.textContent = "Generating sound and preparing your WAV… This can take a few minutes.";
    loading.hidden = false;
    generate.textContent = "Generating Sound…";
    root.setAttribute("aria-busy", "true");
    try {
      apply(await request("/api/music/generate", settings()));
      status.className = "status status--success";
      status.textContent = "Sound saved in your project.";
    } finally {
      loading.hidden = true;
      generate.textContent = "Generate Sound";
      root.setAttribute("aria-busy", "false");
    }
  }));
  audio.addEventListener("play", () => {
    playbackRevision++;
    source?.stop(); source = undefined;
    audition.textContent = "Test Loop";
    playbackStatus.textContent = "";
  });
  audio.addEventListener("error", () => {
    if (audio.hasAttribute("src")) playbackStatus.textContent = "Could not load saved audio.";
  });
  audition.addEventListener("click", async () => {
    if (source) { stopPlayback(); return; }
    stopPlayback();
    const revision = playbackRevision;
    loadingAudio = true;
    updateDisabled();
    try {
      context ??= new AudioContext();
      await context.resume();
      const response = await fetch(audio.src);
      if (!response.ok) throw new Error("Could not load the saved WAV");
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (revision !== playbackRevision) return;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      source.start(0, Math.max(0, buffer.duration - 3));
      audition.textContent = "Stop Test";
      playbackStatus.textContent = "Playing the last 3 seconds, then looping through the beginning.";
    } catch (error) {
      playbackStatus.textContent = error instanceof Error ? error.message : "Could not play the loop";
    } finally { loadingAudio = false; updateDisabled(); }
  });

  return {
    persist, stopPlayback,
    setBusy(busy: boolean) { externalBusy = busy; updateDisabled(); },
    async openProject(name: string | null) {
      if (name === project) return;
      project = name;
      apply({ tracks: [], activeMusicId: "", track: null });
      if (!name) return;
      try {
        if (!modelsLoaded) {
          const response = await request<{ models: { id: string; label: string }[]; hasApiKey: boolean }>("/api/models/music");
          hasApiKey = response.hasApiKey;
          model.replaceChildren(...response.models.map(item => new Option(item.label, item.id)));
          modelsLoaded = true;
        }
        apply(await request<MusicView>("/api/music"));
      } catch (error) {
        // Permit retry when the project is reopened.
        project = null;
        globalStatus.textContent = error instanceof Error ? error.message : "Could not load sounds";
        globalStatus.className = "status status--error";
      }
    },
  };
}
