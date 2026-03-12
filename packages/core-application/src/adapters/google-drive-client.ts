import type { OAuth2Client } from "google-auth-library";
import { type drive_v3, google } from "googleapis";

/**
 * Cria um cliente do Google Drive autenticado.
 *
 * O cliente retornado é utilizado para realizar operações
 * na API do Google Drive, como:
 *
 * - listar arquivos
 * - baixar arquivos
 * - enviar arquivos
 * - atualizar arquivos
 * - excluir arquivos
 *
 * @param auth Cliente OAuth2 autenticado.
 * @returns Instância do cliente `drive_v3.Drive`.
 */
export function createDriveClient(auth: OAuth2Client): drive_v3.Drive {
	return google.drive({
		version: "v3",
		auth,
	});
}
