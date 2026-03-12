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
 * Implementação de `VaultRepository` baseada no filesystem local.
 *
 * Essa classe é responsável por:
 * - percorrer os arquivos reais de um vault
 * - gerar snapshots locais
 * - aplicar changesets no filesystem
 *
 * Diretórios internos e metadados locais do sistema são ignorados
 * durante a geração de snapshots.
 */
export class NodeVaultRepository implements VaultRepository {
	/**
	 * Coleta recursivamente os arquivos de um vault.
	 *
	 * Diretórios internos como `.obsidian`, `.mini-sync` e `.trash`
	 * são ignorados, assim como arquivos de metadados do sistema.
	 *
	 * @param root Caminho absoluto da raiz do vault.
	 * @param current Caminho relativo atual durante a recursão.
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

			if (rel.startsWith(`.obsidian${path.sep}`) || rel === ".obsidian") {
				continue;
			}

			if (rel.startsWith(`.mini-sync${path.sep}`) || rel === ".mini-sync") {
				continue;
			}

			if (rel.startsWith(`.trash${path.sep}`) || rel === ".trash") {
				continue;
			}

			if (entry.name === ".DS_Store") {
				continue;
			}

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
	 * O conteúdo é processado em stream para evitar carregar
	 * arquivos grandes inteiros em memória.
	 *
	 * @param abs Caminho absoluto do arquivo.
	 * @returns Hash SHA-256 em formato hexadecimal.
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
	 * Gera um snapshot do estado atual do vault.
	 *
	 * O snapshot inclui todos os arquivos relevantes do vault,
	 * juntamente com:
	 * - caminho relativo
	 * - hash SHA-256
	 * - tamanho em bytes
	 * - timestamp de modificação
	 *
	 * @param vaultId Identificador do vault.
	 * @returns Snapshot representando o estado atual do vault.
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
				// ignora arquivos que não puderem ser lidos no momento
			}
		}

		const id = crypto.randomUUID();

		const snapshot: Snapshot = {
			id,
			vaultId,
			createdAtMs: Date.now(),
			files: records,
		};

		return snapshot;
	}

	/**
	 * Aplica um changeset ao vault local.
	 *
	 * Regras atuais:
	 * - exclusões são aplicadas primeiro
	 * - arquivos adicionados e modificados são recriados como placeholders vazios
	 *
	 * A escrita do conteúdo real ainda depende de uma etapa futura
	 * de restauração baseada em blobs ou snapshots completos.
	 *
	 * @param vaultId Identificador do vault.
	 * @param changeSet Conjunto de alterações a aplicar.
	 */
	async applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void> {
		const vaultRoot = path.resolve(String(vaultId));

		for (const del of changeSet.deleted) {
			const abs = path.join(vaultRoot, del.path);

			try {
				await fs.rm(abs, { force: true });
			} catch {
				// ignora falhas de remoção
			}
		}

		/**
		 * Cria ou sobrescreve um arquivo de placeholder para refletir
		 * uma alteração estrutural do changeset.
		 *
		 * @param record Registro do arquivo a ser aplicado.
		 */
		const handle = async (record: FileRecord) => {
			const abs = path.join(vaultRoot, record.path);

			await fs.mkdir(path.dirname(abs), { recursive: true });

			try {
				await fs.writeFile(abs, "");
			} catch {
				// ignora falhas de escrita
			}
		};

		for (const rec of changeSet.added) {
			await handle(rec);
		}

		for (const rec of changeSet.modified) {
			await handle(rec);
		}
	}
}