/**
 * Operações possíveis em um diff de linhas.
 *
 * - `equal` → linha presente em ambos os textos
 * - `add` → linha adicionada no novo texto
 * - `del` → linha removida em relação ao texto original
 */
export type DiffOp = "equal" | "add" | "del";

/**
 * Representa um bloco contínuo de operações de diff.
 */
export type DiffChunk = {
	/**
	 * Tipo da operação aplicada ao bloco.
	 */
	op: DiffOp;

	/**
	 * Linhas pertencentes ao bloco de operação.
	 */
	lines: string[];
};

/**
 * Constrói a tabela de programação dinâmica usada pelo algoritmo LCS
 * (Longest Common Subsequence).
 *
 * Essa tabela permite identificar a sequência comum mais longa entre
 * duas listas de linhas, servindo como base para calcular o diff.
 *
 * @param a Linhas do texto original.
 * @param b Linhas do texto modificado.
 * @returns Matriz LCS utilizada para reconstruir as diferenças.
 */
function lcsTable(a: string[], b: string[]) {
	const dp = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);

	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			dp[i][j] =
				a[i] === b[j]
					? 1 + dp[i + 1][j + 1]
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	return dp;
}

/**
 * Calcula um diff linha a linha entre dois textos.
 *
 * O algoritmo utiliza **LCS (Longest Common Subsequence)** para detectar
 * quais linhas foram adicionadas, removidas ou permanecem iguais.
 *
 * O resultado é agrupado em blocos (`DiffChunk`) para facilitar
 * renderização ou análise posterior.
 *
 * @param oldText Texto original.
 * @param newText Texto modificado.
 * @returns Lista de blocos representando as diferenças entre os textos.
 */
export function diffLines(oldText: string, newText: string): DiffChunk[] {
	const a = oldText.split("\n");
	const b = newText.split("\n");
	const dp = lcsTable(a, b);

	const chunks: DiffChunk[] = [];
	let i = 0;
	let j = 0;

	const push = (op: DiffOp, line: string) => {
		const last = chunks[chunks.length - 1];
		if (last && last.op === op) last.lines.push(line);
		else chunks.push({ op, lines: [line] });
	};

	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			push("equal", a[i]);
			i++;
			j++;
			continue;
		}

		// Navega na tabela LCS para decidir se a linha foi removida ou adicionada
		if (dp[i + 1][j] >= dp[i][j + 1]) {
			push("del", a[i]);
			i++;
		} else {
			push("add", b[j]);
			j++;
		}
	}

	while (i < a.length) {
		push("del", a[i]);
		i++;
	}

	while (j < b.length) {
		push("add", b[j]);
		j++;
	}

	return chunks;
}
