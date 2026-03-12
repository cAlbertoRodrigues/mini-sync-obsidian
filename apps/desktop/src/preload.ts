import { contextBridge, ipcRenderer } from "electron";

/**
 * Canais IPC utilizados entre renderer e main process.
 */
type IpcChannel =
	| "changes:list"
	| "changes:readFileSide"
	| "changes:saveMerged"
	| "changes:acceptResolution"
	| "sync:run"
	| "sync:status";

/**
 * Função retornada para cancelar uma inscrição de evento IPC.
 */
type Unsubscribe = () => void;

/**
 * API segura exposta ao renderer process através do contextBridge.
 *
 * Essa interface encapsula chamadas IPC e evita acesso direto ao
 * `ipcRenderer` pela interface da aplicação.
 */
const api = {
	/**
	 * Executa uma chamada IPC do tipo request/response.
	 *
	 * @typeParam T Tipo esperado do retorno da chamada.
	 * @param channel Canal IPC a ser invocado.
	 * @param args Argumentos enviados ao processo principal.
	 * @returns Promise contendo o resultado retornado pelo main process.
	 */
	invoke<T = unknown>(
		channel: Exclude<IpcChannel, "sync:status">,
		args?: unknown,
	) {
		return ipcRenderer.invoke(channel, args) as Promise<T>;
	},

	/**
	 * Registra um listener para eventos enviados pelo processo principal.
	 *
	 * Atualmente utilizado para receber eventos de status de sincronização.
	 *
	 * @typeParam T Tipo do payload recebido.
	 * @param channel Canal de evento IPC.
	 * @param listener Função executada quando o evento é recebido.
	 * @returns Função para cancelar a inscrição do listener.
	 */
	on<T = unknown>(
		channel: Extract<IpcChannel, "sync:status">,
		listener: (payload: T) => void,
	): Unsubscribe {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: T) =>
			listener(payload);

		ipcRenderer.on(channel, wrapped);
		return () => ipcRenderer.removeListener(channel, wrapped);
	},
};

contextBridge.exposeInMainWorld("api", api);

/**
 * Tipo da API exposta ao renderer process.
 */
export type DesktopApi = typeof api;
