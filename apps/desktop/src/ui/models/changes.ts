/**
 * Representa uma alteração detectada em um arquivo do vault após
 * a comparação entre os estados local e remoto.
 *
 * Esse tipo é utilizado pela interface para listar mudanças
 * e indicar possíveis conflitos que precisam de resolução.
 */
export type ChangeRow = {
	/**
	 * Caminho relativo do arquivo dentro do vault.
	 */
	path: string;

	/**
	 * Estado atual de sincronização do arquivo.
	 *
	 * - `synced` → arquivo igual no local e no remoto
	 * - `local_changed` → alterações detectadas apenas no vault local
	 * - `remote_changed` → alterações detectadas apenas no remoto
	 * - `conflict` → alterações conflitantes detectadas
	 */
	status: "synced" | "local_changed" | "remote_changed" | "conflict";

	/**
	 * Texto resumido exibido na interface explicando a alteração detectada.
	 */
	summary: string;

	/**
	 * Tipo de conflito identificado quando `status` é `conflict`.
	 * Pode ser `null` quando não existe conflito.
	 */
	conflictType: string | null;

	/**
	 * Indica se o arquivo possui conflito ativo.
	 */
	isConflict: boolean;

	/**
	 * Quantidade de conflitos detectados para o arquivo.
	 */
	conflictsCount: number;
};

/**
 * Estratégias disponíveis na interface para resolução de conflitos.
 *
 * - `keep_local` → mantém a versão local do arquivo
 * - `keep_remote` → mantém a versão remota
 * - `manual_merge` → permite ao usuário realizar a mesclagem manual
 */
export type ConflictStrategyUi = "keep_local" | "keep_remote" | "manual_merge";
