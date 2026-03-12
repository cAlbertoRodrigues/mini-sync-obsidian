import crypto from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	ChangeSet,
	FileRecord,
	Snapshot,
	VaultId,
} from "@mini-sync/core-domain";
import type { VaultRepository } from "../ports/vault-repository";

/**
 * Implementação Node.js do port `VaultRepository`.
 *
 * O `vaultId` é tratado como o caminho absoluto do vault no filesystem.
 * Esta classe é responsável por:
 * - gerar snapshots do vault
 * - calcular hashes de arquivos
 * - aplicar alterações provenientes de um `ChangeSet`
 */
export class NodeVaultRepository implements VaultRepository {
	/**
	 * Percorre recursivamente o diretório do vault e retorna os caminhos relativos
	 * de todos os arquivos válidos.
	 *
	 * Diretórios internos do Obsidian e metadados do Mini Sync são ignorados.
	 *
	 * @param root Diretório raiz do vault.
	 * @param current Subdiretório atual durante a recursão.
	 * @returns Lista de caminhos relativos de arquivos encontrados.
	 */
	private async collectFiles(
		root: string,
		current: string = "",
	): Promise<string[]> {
		const dir = path.join(root, current);

		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return [];
		}

		const files: string[] = [];

		for (const entry of entries) {
			const rel = path.join(current, entry.name);

			if (rel.startsWith(`.obsidian${path.sep}`) || rel === ".obsidian")
				continue;
			if (rel.startsWith(`.mini-sync${path.sep}`) || rel === ".mini-sync")
				continue;
			if (rel.startsWith(`.trash${path.sep}`) || rel === ".trash") continue;
			if (entry.name === ".DS_Store") continue;

			if (entry.isDirectory()) {
				const nested = await this.collectFiles(root, rel);
				files.push(...nested);
			} else if (entry.isFile()) {
				files.push(rel);
			}
		}

		return files;
	}

	/**
	 * Calcula o hash SHA-256 de um arquivo.
	 *
	 * @param abs Caminho absoluto do arquivo.
	 * @returns Hash do arquivo em formato hexadecimal.
	 */
	private async hashFile(abs: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const hash = crypto.createHash("sha256");
			const stream = createReadStream(abs);

			stream.on("data", (chunk: Buffer) => hash.update(chunk));
			stream.on("error", reject);
			stream.on("end", () => resolve(hash.digest("hex")));
		});
	}

	/**
	 * Gera um snapshot completo do vault atual.
	 *
	 * O snapshot contém:
	 * - lista de arquivos
	 * - hashes
	 * - tamanho
	 * - tempo de modificação
	 *
	 * @param vaultId Identificador do vault (caminho absoluto).
	 * @returns Snapshot do estado atual do vault.
	 */
	async generateSnapshot(vaultId: VaultId): Promise<Snapshot> {
		const vaultRoot = path.resolve(String(vaultId));

		const relativeFiles = await this.collectFiles(vaultRoot);

		const records: FileRecord[] = [];

		for (const rel of relativeFiles) {
			const abs = path.join(vaultRoot, rel);

			try {
				const stat = await fs.stat(abs);
				const hash = await this.hashFile(abs);

				records.push({
					path: rel.replace(/\\/g, "/"),
					hash,
					size: stat.size,
					mtimeMs: stat.mtimeMs,
				});
			} catch {
				// ignora arquivos inacessíveis
			}
		}

		const snapshot: Snapshot = {
			id: crypto.randomUUID(),
			vaultId,
			createdAtMs: Date.now(),
			files: records,
		};

		return snapshot;
	}

	/**
	 * Aplica um conjunto de mudanças ao vault local.
	 *
	 * Atualmente:
	 * - arquivos deletados são removidos
	 * - arquivos adicionados/modificados recebem placeholders vazios
	 *
	 * A restauração completa de conteúdo será implementada em epics futuros
	 * quando snapshots passarem a transportar dados de arquivo.
	 *
	 * @param vaultId Identificador do vault.
	 * @param changeSet Conjunto de mudanças a aplicar.
	 */
	async applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void> {
		const vaultRoot = path.resolve(String(vaultId));

		for (const del of changeSet.deleted) {
			const abs = path.join(vaultRoot, del.path);
			try {
				await fs.rm(abs, { force: true });
			} catch {
				// ignora falhas
			}
		}

		const createPlaceholder = async (record: FileRecord) => {
			const abs = path.join(vaultRoot, record.path);

			await fs.mkdir(path.dirname(abs), { recursive: true });

			try {
				await fs.writeFile(abs, "");
			} catch {
				// ignora falhas de escrita
			}
		};

		for (const rec of changeSet.added) {
			await createPlaceholder(rec);
		}

		for (const rec of changeSet.modified) {
			await createPlaceholder(rec);
		}
	}
}
