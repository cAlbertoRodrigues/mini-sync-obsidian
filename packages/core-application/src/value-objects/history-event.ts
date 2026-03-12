import crypto from "node:crypto";
import type { FileMetadata } from "./file-metadata";

/**
 * Referência a um blob armazenado externamente.
 *
 * Utilizado quando o conteúdo do arquivo é grande ou binário,
 * evitando que o conteúdo completo seja incluído diretamente no evento.
 */
export type HistoryEventBlobRef = {
	/**
	 * Hash SHA-256 do blob armazenado.
	 */
	sha256: string;

	/**
	 * Tamanho do blob em bytes.
	 */
	sizeBytes: number;

	/**
	 * Tipo MIME opcional associado ao conteúdo.
	 */
	mime?: string;
};

/**
 * Representa um evento de histórico associado a uma alteração de arquivo.
 *
 * Eventos são utilizados como base para sincronização incremental
 * entre dispositivos.
 */
export type HistoryEvent = {
	/**
	 * Identificador único do evento.
	 */
	id: string;

	/**
	 * Timestamp ISO indicando quando o evento ocorreu.
	 */
	occurredAtIso: string;

	/**
	 * Origem do evento.
	 */
	origin: "local" | "remote";

	/**
	 * Metadados da alteração associada ao evento.
	 */
	change: FileMetadata;

	/**
	 * Conteúdo textual inline do arquivo.
	 *
	 * Utilizado quando o arquivo é pequeno e textual.
	 */
	contentUtf8?: string;

	/**
	 * Referência a um blob armazenado externamente.
	 *
	 * Utilizado quando o conteúdo é binário ou grande.
	 */
	blob?: HistoryEventBlobRef;
};

/**
 * Cria um novo `HistoryEvent` a partir dos metadados de alteração.
 *
 * Um identificador único e timestamp são gerados automaticamente.
 *
 * @param change Metadados da alteração detectada.
 * @param origin Origem do evento (`local` ou `remote`).
 * @returns Novo evento de histórico.
 */
export function createHistoryEvent(
	change: FileMetadata,
	origin: "local" | "remote" = "local",
): HistoryEvent {
	return {
		id: crypto.randomUUID(),
		occurredAtIso: new Date().toISOString(),
		origin,
		change,
	};
}
