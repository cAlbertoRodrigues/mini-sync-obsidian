/**
 * Resultado possível de uma operação de merge.
 *
 * - `merged` → conteúdo combinado sem conflitos
 * - `conflict` → conflito detectado exigindo resolução manual
 */
type MergeResult =
	| { kind: "merged"; text: string }
	| { kind: "conflict"; text: string };

/**
 * Realiza um merge de três versões de um texto.
 *
 * A função compara:
 * - `base` → versão comum original
 * - `local` → versão modificada localmente
 * - `remote` → versão modificada remotamente
 *
 * Regras aplicadas:
 *
 * 1. Se `local` e `remote` forem iguais → resultado já está resolvido.
 * 2. Se apenas o remoto mudou → usa a versão remota.
 * 3. Se apenas o local mudou → usa a versão local.
 * 4. Caso contrário → gera um conflito explícito.
 *
 * No caso de conflito, o resultado segue um formato semelhante ao
 * utilizado por sistemas de controle de versão (ex: Git).
 *
 * @param base Conteúdo original comum.
 * @param local Versão modificada localmente.
 * @param remote Versão modificada remotamente.
 * @returns Resultado do merge contendo o texto final ou um marcador de conflito.
 */
export function threeWayMerge(
	base: string,
	local: string,
	remote: string,
): MergeResult {
	if (local === remote) return { kind: "merged", text: local };
	if (local === base) return { kind: "merged", text: remote };
	if (remote === base) return { kind: "merged", text: local };

	const text = `<<<<<<< LOCAL
${local}
=======
${remote}
>>>>>>> REMOTE`;

	return { kind: "conflict", text };
}
