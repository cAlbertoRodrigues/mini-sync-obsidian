import fs from "node:fs/promises";
import path from "node:path";
import { NodeBlobStore } from "../adapters/node-blob-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";

import type {
	SnapshotManifest,
	SnapshotManifestFile,
} from "../value-objects/snapshot-manifest";

const DEFAULT_INLINE_TEXT_MAX = 64 * 1024;

/**
 * Converte um caminho para formato POSIX.
 *
 * @param p Caminho original.
 * @returns Caminho usando separador `/`.
 */
function toPosix(p: string): string {
	return p.replaceAll("\\", "/");
}

/**
 * Percorre recursivamente um diretório coletando arquivos válidos.
 *
 * Diretórios internos do Obsidian e metadados do Mini Sync são ignorados.
 *
 * @param rootAbs Raiz do vault.
 * @param dirAbs Diretório atual durante a recursão.
 * @param out Lista acumuladora de arquivos encontrados.
 */
async function walkFiles(
	rootAbs: string,
	dirAbs: string,
	out: string[],
): Promise<void> {
	const entries = await fs.readdir(dirAbs, { withFileTypes: true });

	for (const entry of entries) {
		const abs = path.join(dirAbs, entry.name);
		const rel = toPosix(path.relative(rootAbs, abs));

		if (rel === ".mini-sync" || rel.startsWith(".mini-sync/")) continue;
		if (rel === ".obsidian" || rel.startsWith(".obsidian/")) continue;

		if (entry.isDirectory()) {
			await walkFiles(rootAbs, abs, out);
		} else if (entry.isFile()) {
			out.push(abs);
		}
	}
}

/**
 * Determina se um arquivo provavelmente contém texto UTF-8.
 *
 * A decisão é baseada na extensão do arquivo.
 *
 * @param relPosix Caminho relativo no formato POSIX.
 */
function isProbablyTextByExt(relPosix: string): boolean {
	const lower = relPosix.toLowerCase();

	return (
		lower.endsWith(".md") ||
		lower.endsWith(".txt") ||
		lower.endsWith(".json") ||
		lower.endsWith(".yaml") ||
		lower.endsWith(".yml") ||
		lower.endsWith(".csv")
	);
}

/**
 * Serviço responsável por gerar manifests de snapshot do vault.
 *
 * O processo:
 * - percorre todos os arquivos do vault
 * - calcula hashes
 * - inclui conteúdo inline quando pequeno e textual
 * - armazena blobs quando necessário
 */
export class SnapshotService {
	constructor(
		private readonly hasher = new NodeFileHasher(),
		private readonly blobStore = new NodeBlobStore(),
	) {}

	/**
	 * Gera um `SnapshotManifest` representando o estado atual do vault.
	 *
	 * @param params Parâmetros de geração do snapshot.
	 */
	async createSnapshotManifest(params: {
		/**
		 * Caminho absoluto da raiz do vault.
		 */
		vaultRootAbs: string;

		/**
		 * Identificador do vault.
		 */
		vaultId: string;

		/**
		 * Limite máximo de bytes para conteúdo inline.
		 */
		inlineTextMaxBytes?: number;
	}): Promise<SnapshotManifest> {
		const { vaultRootAbs, vaultId } = params;

		const inlineMax = params.inlineTextMaxBytes ?? DEFAULT_INLINE_TEXT_MAX;

		const filesAbs: string[] = [];

		await walkFiles(vaultRootAbs, vaultRootAbs, filesAbs);

		const manifestFiles: SnapshotManifestFile[] = [];

		for (const abs of filesAbs) {
			const rel = toPosix(path.relative(vaultRootAbs, abs));

			const stat = await fs.stat(abs);
			const hash = await this.hasher.hashFile(abs);

			const file: SnapshotManifestFile = {
				path: rel,
				sha256: hash.value,
				sizeBytes: stat.size,
				mtimeMs: stat.mtimeMs,
			};

			if (isProbablyTextByExt(rel) && stat.size <= inlineMax) {
				try {
					file.inlineTextUtf8 = await fs.readFile(abs, "utf-8");
				} catch {
					const buf = await fs.readFile(abs);
					await this.blobStore.put(vaultRootAbs, hash.value, buf);
					file.blobSha256 = hash.value;
				}
			} else {
				const buf = await fs.readFile(abs);
				await this.blobStore.put(vaultRootAbs, hash.value, buf);
				file.blobSha256 = hash.value;
			}

			manifestFiles.push(file);
		}

		const id = `snap-${new Date()
			.toISOString()
			.replaceAll(":", "")
			.replaceAll(".", "")}`;

		return {
			id,
			vaultId,
			createdAtIso: new Date().toISOString(),
			files: manifestFiles,
		};
	}
}
