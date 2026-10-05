/** A floating preview avoids clipping at the edges of the scrollable frame grid. */
export function mountFrameMagnifier(grid: HTMLElement) {
  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "frame-tile frame-magnifier";
  bubble.tabIndex = -1;
  bubble.hidden = true;
  document.body.append(bubble);
  let index: string | undefined;
  let source: string | undefined;
  let pointer: { x: number; y: number } | undefined;

  function hide() {
    bubble.hidden = true;
    index = undefined;
    source = undefined;
    pointer = undefined;
  }

  function show(tile: HTMLElement, reposition = true) {
    if (grid.inert || tile.classList.contains("is-empty")) return;
    index = tile.dataset.index;
    source = tile.querySelector("img")?.getAttribute("src") ?? undefined;
    const rect = tile.getBoundingClientRect();
    const size = Math.min(152, window.innerWidth - 16, window.innerHeight - 16);
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    if (reposition) {
      bubble.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - size / 2, window.innerWidth - size - 8))}px`;
      bubble.style.top = `${Math.max(8, Math.min(rect.top + rect.height / 2 - size / 2, window.innerHeight - size - 8))}px`;
    }
    if (bubble.innerHTML !== tile.innerHTML) bubble.innerHTML = tile.innerHTML;
    bubble.hidden = false;
    refresh();
  }

  function followScroll() {
    if (bubble.hidden || !pointer || grid.inert) { hide(); return; }
    const bounds = grid.getBoundingClientRect();
    // The bubble extends beyond the grid edges. Inspect the nearest visible tile
    // there, and bridge the small gaps between tiles while scrolling.
    const x = Math.max(bounds.left, Math.min(pointer.x, bounds.right));
    const y = Math.max(bounds.top, Math.min(pointer.y, bounds.bottom));
    let nearest: HTMLElement | undefined;
    let distance = Infinity;
    for (const tile of grid.querySelectorAll<HTMLElement>(".frame-tile:not(.is-empty)")) {
      const rect = tile.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const next = dx * dx + dy * dy;
      if (next < distance) { nearest = tile; distance = next; }
    }
    if (nearest) show(nearest, false);
    else hide();
  }

  function refresh() {
    if (index === undefined) return;
    const tile = grid.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (grid.inert || !grid.getClientRects().length || !tile || tile.querySelector("img")?.getAttribute("src") !== source) {
      hide();
      return;
    }
    const selected = tile.classList.contains("is-selected");
    bubble.classList.toggle("is-selected", selected);
    bubble.classList.toggle("frame-magnifier--smooth", !!grid.closest(".sprites-workspace--smooth"));
    bubble.setAttribute("aria-pressed", String(selected));
    bubble.setAttribute("aria-label", `Frame ${Number(index) + 1}: ${selected ? "selected, click to exclude" : "excluded, click to include"}`);
  }

  grid.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".frame-tile");
    if (tile) show(tile);
  });
  grid.addEventListener("pointerout", event => {
    const next = event.relatedTarget as Node | null;
    if (!next || (!grid.contains(next) && !bubble.contains(next))) hide();
  });
  grid.addEventListener("focusin", event => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".frame-tile");
    if (tile) show(tile);
  });
  grid.addEventListener("focusout", event => {
    if (!bubble.contains(event.relatedTarget as Node | null)) hide();
  });
  // Keep focus on the original tile so keyboard navigation follows the grid.
  bubble.addEventListener("pointerdown", event => event.preventDefault());
  bubble.addEventListener("click", () => {
    if (!grid.inert && index !== undefined) grid.querySelector<HTMLElement>(`[data-index="${index}"]`)?.click();
  });
  bubble.addEventListener("pointerleave", hide);
  bubble.addEventListener("pointermove", event => {
    pointer = { x: event.clientX, y: event.clientY };
  });
  bubble.addEventListener("wheel", event => {
    // Preserve browser zoom gestures (including trackpad pinch).
    if (event.ctrlKey || grid.inert) return;
    event.preventDefault();
    pointer = { x: event.clientX, y: event.clientY };
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? grid.clientHeight : 1;
    grid.scrollBy({ top: event.deltaY * unit, left: event.deltaX * unit, behavior: "instant" });
  }, { passive: false });
  window.addEventListener("scroll", event => {
    if (event.target === grid) followScroll();
    else hide();
  }, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  return { refresh };
}
