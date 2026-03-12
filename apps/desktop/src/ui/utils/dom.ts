/**
 * Cria um elemento HTML tipado e aplica propriedades iniciais.
 *
 * Essa função é um utilitário para simplificar a criação de elementos
 * DOM na interface, permitindo definir propriedades diretamente
 * no momento da criação.
 *
 * @typeParam K Tag HTML que será criada.
 * @param tag Nome da tag HTML.
 * @param props Propriedades a serem atribuídas ao elemento criado.
 * @returns Elemento HTML tipado correspondente à tag informada.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	Object.assign(node, props);
	return node;
}
