import { chevronIcon } from "./icons";

const BACKGROUNDS = [
  { label: "Transparent", color: null, ink: "#111827" },
  { label: "Mid-tone Gray", color: "#808080", ink: "#111827" },
  { label: "Deep Blue-Gray", color: "#2c3e50", ink: "#ffffff" },
  { label: "Chroma Key Green", color: "#00FF00", ink: "#111827" },
  { label: "Magenta", color: "#FF00FF", ink: "#111827" },
  { label: "Off-White", color: "#F7F7F7", ink: "#111827" },
] as const;

/** Backdrops are display-only; changing them never redraws or saves the asset. */
export function mountPreviewBackground(root: HTMLElement, previews: readonly HTMLElement[]) {
  const name = (option: typeof BACKGROUNDS[number]) =>
    option.color ? `${option.label} (${option.color})` : option.label;
  root.innerHTML = `
    <span class="preview-background__label" aria-hidden="true">Background</span>
    <button class="preview-background__toggle preview-background__swatch" type="button"
      aria-label="Preview background: Transparent" title="Preview background: Transparent"
      aria-expanded="false" aria-controls="preview-background-options">
      <span class="preview-background__chevron" aria-hidden="true">${chevronIcon}</span>
    </button>
    <div id="preview-background-options" class="preview-background__options" role="group"
      aria-label="Preview background colours" inert>
      ${BACKGROUNDS.map((option, index) => `
        <button class="preview-background__swatch" type="button"
          aria-label="${name(option)}" title="${name(option)}" aria-pressed="${index === 0}"
          style="--swatch-index: ${index}; color: ${option.ink}; ${option.color ? `background: ${option.color};` : ""}">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="m5 10 3.5 3.5L15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>`).join("")}
    </div>`;

  const toggle = root.querySelector<HTMLButtonElement>(".preview-background__toggle")!;
  const options = root.querySelector<HTMLElement>(".preview-background__options")!;
  const swatches = [...options.querySelectorAll<HTMLButtonElement>("button")];
  let selected = 0;
  let open = false;

  function setOpen(value: boolean, returnFocus = false) {
    open = value;
    root.classList.toggle("is-open", value);
    toggle.setAttribute("aria-expanded", String(value));
    options.inert = !value;
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(!open));
  swatches.forEach((swatch, index) => {
    swatch.addEventListener("click", () => {
      selected = index;
      const option = BACKGROUNDS[index];
      for (const preview of previews) {
        preview.style.background = option.color ?? "";
        preview.style.setProperty("--preview-placeholder-color", option.color ? option.ink : "var(--text-subtle)");
      }
      toggle.style.background = option.color ?? "";
      toggle.title = `Preview background: ${name(option)}`;
      toggle.setAttribute("aria-label", toggle.title);
      swatches.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
      setOpen(false, true);
    });
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = swatches.indexOf(document.activeElement as HTMLButtonElement);
    setOpen(true);
    const next = event.key === "Home" ? 0 : event.key === "End" ? swatches.length - 1
      : current < 0 ? selected
      : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + swatches.length) % swatches.length;
    swatches[next].focus();
  });
  document.addEventListener("pointerdown", event => {
    if (open && !root.contains(event.target as Node)) setOpen(false);
  });
  root.addEventListener("focusout", event => {
    if (open && !root.contains(event.relatedTarget as Node | null)) setOpen(false);
  });
}
