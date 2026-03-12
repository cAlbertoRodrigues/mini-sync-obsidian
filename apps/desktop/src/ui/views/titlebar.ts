import { el } from "../utils/dom.js";

type WindowControlsApi = {
	minimize?: () => void;
	close?: () => void;
};

function getWindowControls(): WindowControlsApi | undefined {
	return (window as Window & { windowControls?: WindowControlsApi })
		.windowControls;
}

/**
 * Renderiza a barra de título personalizada da aplicação.
 *
 * A barra inclui:
 * - área de arraste da janela
 * - título do aplicativo
 * - botões de minimizar e fechar
 *
 * Os controles da janela são acessados via API exposta pelo preload
 * (`window.windowControls`).
 *
 * @returns Elemento HTML da barra de título.
 */
export function renderTitlebar(): HTMLElement {
	const bar = el("div", { className: "ms-titlebar" });

	const drag = el("div", { className: "ms-titlebar-drag" });
	drag.append(
		el("span", { className: "ms-titlebar-title", textContent: "Mini Sync" }),
	);

	const actions = el("div", { className: "ms-titlebar-actions" });

	const btnMin = el("button", {
		className: "ms-titlebar-btn",
		textContent: "—",
	}) as HTMLButtonElement;
	btnMin.addEventListener("click", () => {
		getWindowControls()?.minimize?.();
	});

	const btnClose = el("button", {
		className: "ms-titlebar-btn ms-titlebar-btn--close",
		textContent: "×",
	}) as HTMLButtonElement;
	btnClose.addEventListener("click", () => {
		getWindowControls()?.close?.();
	});

	actions.append(btnMin, btnClose);
	bar.append(drag, actions);

	return bar;
}
