import fs from "node:fs/promises";
import path from "node:path";

import { ChokidarFileWatcher } from "../adapters/chokidar-file-watcher";
import { NodeBlobStore } from "../adapters/node-blob-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { createObsidianIgnore } from "../adapters/obsidian-ignore";
import type { FileMetadata } from "../value-objects/file-metadata";
import { createHistoryEvent } from "../value-objects/history-event";

/**
 * Remove aspas externas de uma string quando presentes.
 *
 * @param input Valor bruto recebido via CLI.
 * @returns String sem aspas externas.
 */
function stripOuterQuotes(input: string): string {
	return input.replace(/^"(.*)"$/, "$1");
}

/**
 * Verifica se um caminho relativo permanece dentro da raiz do vault.
 *
 * @param relPath Caminho relativo calculado a partir da raiz do vault.
 * @returns `true` quando o caminho estiver contido no vault.
 */
function isInsideVault(relPath: string): boolean {
	return (
		relPath !== "" &&
		!relPath.startsWith("..") &&
		!relPath.startsWith("../") &&
		!path.isAbsolute(relPath)
	);
}

/**
 * Verifica se um caminho existe no sistema de arquivos.
 *
 * @param p Caminho a verificar.
 * @returns `true` quando o caminho existir.
 */
async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Determina se um arquivo provavelmente pode ser tratado como texto UTF-8 inline.
 *
 * @param rel Caminho relativo do arquivo.
 * @returns `true` quando a extensão for compatível com conteúdo textual simples.
 */
function isProbablyText(rel: string): boolean {
	const lower = rel.toLowerCase();

	return (
		lower.endsWith(".md") ||
		lower.endsWith(".txt") ||
		lower.endsWith(".json") ||
		lower.endsWith(".yml") ||
		lower.endsWith(".yaml")
	);
}

/**
 * Executa o watcher do vault local e registra eventos de histórico para mudanças detectadas.
 *
 * O fluxo:
 * - observa arquivos do vault
 * - ignora áreas internas do Mini Sync e do Obsidian
 * - calcula hash e metadados
 * - armazena conteúdo inline quando pequeno e textual
 * - armazena blobs quando necessário
 * - persiste eventos no histórico local
 */
async function main(): Promise<void> {
	const rawVaultPath = process.argv[2];

	if (!rawVaultPath) {
		console.error("Uso: pnpm dev:watch -- <caminho-do-vault>");
		process.exit(1);
	}

	const vaultPath = stripOuterQuotes(rawVaultPath);
	const vaultAbs = path.resolve(vaultPath);

	const historyRepo = new NodeHistoryRepository();
	const watcher = new ChokidarFileWatcher();
	const hasher = new NodeFileHasher();
	const blobStore = new NodeBlobStore();

	const applyingLockAbs = path.join(
		vaultAbs,
		".mini-sync",
		"state",
		"applying.lock",
	);

	let ignoreUntilMs = 0;
	const lastHashByPath = new Map<string, string>();
	const inlineTextMaxBytes = 64 * 1024;

	/**
	 * Processa um evento emitido pelo watcher e o transforma em um evento persistido de histórico.
	 *
	 * O processamento ignora alterações geradas durante aplicação remota, evita ruído de modificações
	 * sem mudança real de hash e decide entre conteúdo inline ou armazenamento em blob.
	 *
	 * @param e Evento emitido pelo watcher de arquivos.
	 */
	watcher.onEvent(async (e) => {
		const now = Date.now();

		if (await exists(applyingLockAbs)) {
			ignoreUntilMs = Math.max(ignoreUntilMs, now + 1500);
			return;
		}

		if (now < ignoreUntilMs) {
			return;
		}

		const abs = path.isAbsolute(e.path) ? e.path : path.join(vaultAbs, e.path);
		const rel = path.relative(vaultAbs, abs).replaceAll("\\", "/");

		if (!isInsideVault(rel)) {
			return;
		}

		if (rel.startsWith(".mini-sync/") || rel === ".mini-sync") {
			return;
		}

		if (rel.startsWith(".obsidian/") || rel === ".obsidian") {
			return;
		}

		const meta: FileMetadata = {
			path: rel,
			absolutePath: abs,
			changeType: e.type,
			occurredAt: e.occurredAt,
		};

		let contentUtf8: string | undefined;
		let blobSha: string | undefined;

		if (e.type !== "deleted") {
			try {
				const stat = await fs.stat(abs);
				meta.sizeBytes = stat.size;
				meta.mtimeMs = stat.mtimeMs;

				meta.hash = await hasher.hashFile(abs);

				if (e.type === "modified" && meta.hash?.value) {
					const previousHash = lastHashByPath.get(rel);

					if (previousHash && previousHash === meta.hash.value) {
						return;
					}

					lastHashByPath.set(rel, meta.hash.value);
				}

				if (meta.hash?.value) {
					const buffer = await fs.readFile(abs);

					if (isProbablyText(rel) && buffer.byteLength <= inlineTextMaxBytes) {
						contentUtf8 = buffer.toString("utf-8");
					} else {
						await blobStore.put(vaultAbs, meta.hash.value, buffer);
						blobSha = meta.hash.value;
					}
				}
			} catch (err) {
				console.error("Falha ao ler/stat/hash:", abs, err);
			}
		} else {
			lastHashByPath.delete(rel);
		}

		const event = createHistoryEvent(meta, "local");

		if (contentUtf8 !== undefined) {
			event.contentUtf8 = contentUtf8;
		} else if (blobSha && meta.sizeBytes) {
			event.blob = {
				sha256: blobSha,
				sizeBytes: meta.sizeBytes,
			};
		}

		await historyRepo.append(vaultAbs, event);

		console.log(
			`[${meta.occurredAt.toISOString()}] ${meta.changeType}: ${meta.path}` +
				(meta.hash ? ` sha256=${meta.hash.value.slice(0, 12)}...` : "") +
				(event.blob ? ` blob=${event.blob.sha256.slice(0, 12)}...` : "") +
				(event.contentUtf8 !== undefined
					? ` inlineText=${event.contentUtf8.length}B`
					: ""),
		);
	});

	await watcher.start({
		rootDir: vaultAbs,
		ignore: createObsidianIgnore(vaultAbs),
	});

	console.log("Watching:", vaultAbs);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
