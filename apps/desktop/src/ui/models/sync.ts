/**
 * Estados possíveis da sincronização exibidos na interface.
 *
 * - `idle` → nenhuma sincronização em andamento
 * - `syncing` → sincronização em progresso
 * - `ok` → sincronização concluída com sucesso
 * - `conflict` → sincronização concluída com conflitos detectados
 * - `error` → erro ocorreu durante a sincronização
 */
export type SyncUiStatus = "idle" | "syncing" | "ok" | "conflict" | "error";

/**
 * Payload utilizado para atualizar o estado de sincronização
 * de um vault na interface.
 *
 * Cada variação representa um evento diferente no ciclo de
 * sincronização.
 */
export type SyncStatusPayload =
	/**
	 * Evento emitido quando uma sincronização é iniciada.
	 */
	| {
			/**
			 * Identificador do vault.
			 */
			vaultId: string;

			/**
			 * Estado atual da sincronização.
			 */
			status: "syncing";

			/**
			 * Momento do evento em formato ISO.
			 */
			atIso: string;
	  }

	/**
	 * Evento emitido quando a sincronização termina.
	 */
	| {
			/**
			 * Identificador do vault.
			 */
			vaultId: string;

			/**
			 * Resultado da sincronização.
			 */
			status: "ok" | "conflict";

			/**
			 * Momento do evento em formato ISO.
			 */
			atIso: string;

			/**
			 * Resumo opcional da operação executada.
			 */
			summary?: unknown;
	  }

	/**
	 * Evento emitido quando ocorre um erro durante a sincronização.
	 */
	| {
			/**
			 * Identificador do vault.
			 */
			vaultId: string;

			/**
			 * Indica falha na sincronização.
			 */
			status: "error";

			/**
			 * Momento do erro em formato ISO.
			 */
			atIso: string;

			/**
			 * Mensagem descritiva do erro ocorrido.
			 */
			error: string;
	  };
