/**
 * Cria um botão padrão utilizado na interface do aplicativo.
 *
 * O botão pode ser renderizado em duas variações visuais:
 * - padrão (`btn`)
 * - primária (`btn btn-primary`)
 *
 * A estilização depende das classes CSS definidas no tema da aplicação.
 *
 * @param label Texto exibido dentro do botão.
 * @param primary Define se o botão deve utilizar o estilo primário.
 * @returns Elemento HTMLButtonElement configurado e pronto para uso no DOM.
 */
export function createButton(
	label: string,
	primary = false,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = primary ? "btn btn-primary" : "btn";
	btn.textContent = label;
	return btn;
}
