import { el } from "../utils/dom.js";

export function renderTitlebar(): HTMLElement {
  const bar = el("div", { className: "ms-titlebar" });

  const drag = el("div", { className: "ms-titlebar-drag" });
  drag.append(el("span", { className: "ms-titlebar-title", textContent: "Mini Sync" }));

  const actions = el("div", { className: "ms-titlebar-actions" });

  const btnMin = el("button", { className: "ms-titlebar-btn", textContent: "—" }) as HTMLButtonElement;
  btnMin.addEventListener("click", () => {
    // preload expõe windowControls
    (window as any).windowControls?.minimize?.();
  });

  const btnClose = el("button", {
    className: "ms-titlebar-btn ms-titlebar-btn--close",
    textContent: "×",
  }) as HTMLButtonElement;
  btnClose.addEventListener("click", () => {
    (window as any).windowControls?.close?.();
  });

  actions.append(btnMin, btnClose);
  bar.append(drag, actions);
  return bar;
}
