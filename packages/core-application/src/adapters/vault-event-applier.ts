import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryEvent } from "../value-objects/history-event";
import { NodeBlobStore } from "./node-blob-store";

/**
 * Responsável por aplicar eventos de histórico diretamente
 * no filesystem do vault local.
 *
 * O applier suporta:
 * - remoção de arquivos
 * - escrita de conteúdo textual inline
 * - restauração de conteúdo a partir de blobs locais
 *
 * Esse componente atua como a etapa final da aplicação de mudanças
 * vindas de sincronização remota.
 */
export class VaultEventApplier {
	/**
	 * Armazenamento local de blobs usado para restaurar arquivos binários
	 * ou conteúdos não enviados inline no evento.
	 */
	private blobStore = new NodeBlobStore();

	/**
	 * Aplica uma sequência de eventos de histórico no vault local.
	 *
	 * Regras aplicadas:
	 * - eventos `deleted` removem o arquivo
	 * - eventos com `contentUtf8` escrevem conteúdo textual inline
	 * - eventos com `blob.sha256` restauram o conteúdo a partir do blob local
	 * - eventos sem conteúdo aplicável são ignorados
	 *
	 * @param vaultRootAbs Caminho absoluto da raiz do vault.
	 * @param events Lista de eventos a aplicar.
	 */
	async apply(vaultRootAbs: string, events: HistoryEvent[]): Promise<void> {
		for (const ev of events) {
			const rel = ev.change.path.replaceAll("\\", "/");
			const abs = path.join(vaultRootAbs, rel);

			if (ev.change.changeType === "deleted") {
				await fs.rm(abs, { force: true });
				continue;
			}

			await fs.mkdir(path.dirname(abs), { recursive: true });

			if (ev.contentUtf8 !== undefined) {
				await fs.writeFile(abs, ev.contentUtf8, "utf-8");
				continue;
			}

			if (ev.blob?.sha256) {
				const data = await this.blobStore.get(vaultRootAbs, ev.blob.sha256);
				await fs.writeFile(abs, data);
			}
		}
	}
}
