export function createButton(label: string, primary = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = primary ? "btn btn-primary" : "btn";
  btn.textContent = label;
  return btn;
}
