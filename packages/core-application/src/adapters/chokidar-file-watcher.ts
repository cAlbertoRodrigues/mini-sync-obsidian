import path from "node:path";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";

import type {
	FileChangeEvent,
	FileChangeType,
	FileWatcher,
	FileWatcherOptions,
} from "../ports/file-watcher";

/**
 * Implementação do FileWatcher utilizando a biblioteca Chokidar.
 *
 * Responsável por observar alterações no sistema de arquivos
 * dentro do vault local e emitir eventos normalizados para o
 * mecanismo de sincronização.
 *
 * Eventos monitorados:
 * - criação de arquivo
 * - modificação de arquivo
 * - remoção de arquivo
 *
 * Esses eventos são convertidos para o formato `FileChangeEvent`
 * definido na porta `FileWatcher`.
 */
export class ChokidarFileWatcher implements FileWatcher {
	/**
	 * Instância ativa do watcher do Chokidar.
	 */
	private watcher: FSWatcher | null = null;

	/**
	 * Handler registrado para receber eventos do watcher.
	 */
	private handler: ((event: FileChangeEvent) => void) | null = null;

	/**
	 * Registra o handler que será chamado quando ocorrerem
	 * eventos de alteração no filesystem.
	 *
	 * @param handler Função que recebe eventos de alteração.
	 */
	onEvent(handler: (event: FileChangeEvent) => void): void {
		this.handler = handler;
	}

	/**
	 * Inicia o monitoramento do diretório do vault.
	 *
	 * O watcher ignora eventos iniciais e aguarda a estabilização
	 * da escrita para evitar múltiplos eventos durante salvamentos.
	 *
	 * @param options Configurações do watcher.
	 */
	async start(options: FileWatcherOptions): Promise<void> {
		if (this.watcher) return;

		const rootDir = path.resolve(options.rootDir);

		this.watcher = chokidar.watch(rootDir, {
			persistent: true,
			ignoreInitial: true,

			awaitWriteFinish: {
				stabilityThreshold: 250,
				pollInterval: 50,
			},

			ignored: (p: string) => options.ignore(path.resolve(p)),
		});

		const emit = (type: FileChangeType, filePath: string) => {
			if (!this.handler) return;

			const event: FileChangeEvent = {
				type,
				path: path.resolve(filePath),
				occurredAt: new Date(),
			};

			this.handler(event);
		};

		this.watcher
			.on("add", (p: string) => emit("created", p))
			.on("change", (p: string) => emit("modified", p))
			.on("unlink", (p: string) => emit("deleted", p));
	}

	/**
	 * Encerra o watcher ativo e libera os recursos associados.
	 */
	async stop(): Promise<void> {
		if (!this.watcher) return;

		await this.watcher.close();
		this.watcher = null;
	}
}
