export function confirmDelete(kind: "character" | "animation" | "sound", name: string): Promise<boolean> {
  const dialog = document.createElement("dialog");
  dialog.className = "name-dialog delete-dialog";
  dialog.setAttribute("aria-labelledby", "delete-dialog-title");
  dialog.setAttribute("aria-describedby", "delete-dialog-question");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="delete-dialog-title">Delete ${kind}</h2>
    <p id="delete-dialog-question"></p>
    <div class="name-dialog__actions">
      <button class="btn btn--secondary" value="no" autofocus>No</button>
      <button class="btn btn--danger" value="yes">Yes</button>
    </div>
  </form>`;
  dialog.querySelector("#delete-dialog-question")!.textContent = `Are you sure you want to delete ${name}?`;
  document.body.appendChild(dialog);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "yes";
      dialog.remove();
      resolve(confirmed);
    }, { once: true });
    dialog.showModal();
  });
}
