import fs from "node:fs/promises";
import path from "node:path";

/**
 * Armazena blobs locais do Mini Sync no filesystem.
 *
 * Os blobs são persistidos em:
 *
 * ```txt
 * <vaultRootAbs>/.mini-sync/blobs/<sha256>
 * ```
 *
 * Cada blob é identificado pelo hash SHA-256 do seu conteúdo.
 */
export class NodeBlobStore {
	/**
	 * Retorna o diretório onde os blobs do vault são armazenados.
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @returns Caminho absoluto do diretório de blobs.
	 */
	private blobsDir(vaultRootAbs: string) {
		return path.join(vaultRootAbs, ".mini-sync", "blobs");
	}

	/**
	 * Retorna o caminho absoluto de um blob específico.
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @param sha256 Hash SHA-256 do blob.
	 * @returns Caminho absoluto do arquivo de blob.
	 */
	private blobPath(vaultRootAbs: string, sha256: string) {
		return path.join(this.blobsDir(vaultRootAbs), sha256);
	}

	/**
	 * Verifica se um blob já existe localmente.
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @param sha256 Hash SHA-256 do blob.
	 * @returns `true` quando o blob existe.
	 */
	async has(vaultRootAbs: string, sha256: string): Promise<boolean> {
		try {
			await fs.stat(this.blobPath(vaultRootAbs, sha256));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Persiste um blob no armazenamento local.
	 *
	 * O diretório de blobs é criado automaticamente quando necessário.
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @param sha256 Hash SHA-256 do blob.
	 * @param data Conteúdo binário do blob.
	 */
	async put(vaultRootAbs: string, sha256: string, data: Buffer): Promise<void> {
		await fs.mkdir(this.blobsDir(vaultRootAbs), { recursive: true });
		await fs.writeFile(this.blobPath(vaultRootAbs, sha256), data);
	}

	/**
	 * Recupera um blob do armazenamento local.
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @param sha256 Hash SHA-256 do blob.
	 * @returns Conteúdo binário do blob.
	 */
	async get(vaultRootAbs: string, sha256: string): Promise<Buffer> {
		return fs.readFile(this.blobPath(vaultRootAbs, sha256));
	}
}