import { chevronIcon } from "./icons";
import { DEFAULT_FRAME_SIZE, FRAME_SIZES, type FrameSize } from "../lib/frame-size";

/** Output size is an animation setting; selecting it does not rebuild saved assets. */
export function mountFrameSize(root: HTMLElement, onChange: (size: FrameSize) => void) {
  root.innerHTML = `
    <span class="preview-background__label" aria-hidden="true">Frame size</span>
    <button class="preview-background__toggle preview-background__swatch" type="button"
      aria-expanded="false" aria-controls="frame-size-options" aria-describedby="sheet-size-hint">
      <span class="frame-size__value"></span>
      <span class="preview-background__chevron" aria-hidden="true">${chevronIcon}</span>
    </button>
    <div id="frame-size-options" class="preview-background__options" role="group"
      aria-label="Frame size in pixels" inert>
      ${FRAME_SIZES.map((size, index) => `
        <button class="preview-background__swatch" type="button"
          aria-label="${size} × ${size} pixels${size === DEFAULT_FRAME_SIZE ? " (default)" : ""}"
          title="${size} × ${size} pixels${size === DEFAULT_FRAME_SIZE ? " (default)" : ""}"
          style="--swatch-index: ${index}">${size}×${size}</button>`).join("")}
    </div>`;
  const toggle = root.querySelector<HTMLButtonElement>(".preview-background__toggle")!;
  const value = root.querySelector<HTMLElement>(".frame-size__value")!;
  const options = root.querySelector<HTMLElement>(".preview-background__options")!;
  const buttons = [...options.querySelectorAll<HTMLButtonElement>("button")];
  let selected: FrameSize = DEFAULT_FRAME_SIZE;
  let open = false;

  function setOpen(next: boolean, returnFocus = false) {
    open = next && !toggle.disabled;
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    options.inert = !open;
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(!open));
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      if (toggle.disabled) return;
      setOpen(false, true);
      onChange(FRAME_SIZES[index]);
    });
  });
  root.addEventListener("keydown", event => {
    if (toggle.disabled) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    setOpen(true);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : current < 0 ? FRAME_SIZES.indexOf(selected)
      : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  document.addEventListener("pointerdown", event => {
    if (open && !root.contains(event.target as Node)) setOpen(false);
  });
  root.addEventListener("focusout", event => {
    if (open && !root.contains(event.relatedTarget as Node | null)) setOpen(false);
  });

  return {
    update(size: FrameSize, disabled: boolean) {
      if (selected !== size || disabled) setOpen(false);
      selected = size;
      value.textContent = `${size} × ${size}`;
      toggle.title = `Frame size: ${size} × ${size} pixels`;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.disabled = disabled;
      buttons.forEach((button, index) => {
        button.disabled = disabled;
        button.setAttribute("aria-pressed", String(FRAME_SIZES[index] === size));
      });
    },
  };
}
