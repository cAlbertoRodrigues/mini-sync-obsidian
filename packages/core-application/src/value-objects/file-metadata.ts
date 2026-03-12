import type { FileHash } from "../ports/file-hasher";
import type { FileChangeType } from "../ports/file-watcher";

/**
 * Metadados associados a uma alteração de arquivo dentro do vault.
 */
export type FileMetadata = {
	/**
	 * Caminho relativo do arquivo dentro do vault, normalizado em formato POSIX.
	 */
	path: string;

	/**
	 * Caminho absoluto do arquivo no sistema de arquivos local.
	 */
	absolutePath: string;

	/**
	 * Tipo de alteração detectada no arquivo.
	 */
	changeType: FileChangeType;

	/**
	 * Momento em que a alteração ocorreu.
	 */
	occurredAt: Date;

	/**
	 * Hash calculado do conteúdo do arquivo, quando disponível.
	 */
	hash?: FileHash;

	/**
	 * Tamanho do arquivo em bytes, quando disponível.
	 */
	sizeBytes?: number;

	/**
	 * Timestamp de modificação do arquivo em milissegundos, quando disponível.
	 */
	mtimeMs?: number;

	/**
	 * MIME type do arquivo, quando conhecido.
	 */
	mime?: string;
};
