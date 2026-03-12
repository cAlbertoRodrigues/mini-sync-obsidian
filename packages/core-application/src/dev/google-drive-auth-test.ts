import path from "node:path";
import { google } from "googleapis";

import { GoogleAuth } from "../adapters/google-auth";

/**
 * Representa um cliente OAuth com os métodos usados neste script.
 */
type AuthLike = {
	getRequestHeaders?: () => Promise<Record<string, string>>;
	getAccessToken?: () => Promise<{ token?: string | null } | null>;
	constructor?: {
		name?: string;
	};
};

/**
 * Converte um valor desconhecido para um cliente de autenticação parcial.
 *
 * @param value Valor a converter.
 * @returns Estrutura compatível com os métodos usados no script.
 */
function asAuthLike(value: unknown): AuthLike {
	if (typeof value !== "object" || value === null) {
		return {};
	}

	return value as AuthLike;
}

/**
 * Script utilitário para testar autenticação com Google Drive.
 *
 * Uso:
 *
 * ```bash
 * pnpm tsx google-drive-auth-test.ts <vaultPath>
 * ```
 *
 * O vault deve conter:
 *
 * ```text
 * .mini-sync/secrets/google.credentials.json
 * ```
 */
async function main(): Promise<void> {
	const vaultAbs = path.resolve(process.argv[2] ?? "");
	const tokenDirAbs = path.join(vaultAbs, ".mini-sync", "secrets");
	const credentialsPathAbs = path.join(
		tokenDirAbs,
		"google.credentials.json",
	);

	const ga = new GoogleAuth({
		tokenDirAbs,
		credentialsPathAbs,
	});

	const auth = await ga.getAuthorizedClient();
	const authLike = asAuthLike(auth);

	console.log("Auth type:", authLike.constructor?.name ?? "unknown");

	console.log(
		"Has getRequestHeaders?",
		typeof authLike.getRequestHeaders === "function",
	);

	const headers =
		typeof authLike.getRequestHeaders === "function"
			? await authLike.getRequestHeaders()
			: {};

	console.log(
		"Authorization header exists?",
		Boolean(headers.authorization),
	);

	const accessToken =
		typeof authLike.getAccessToken === "function"
			? await authLike.getAccessToken()
			: null;

	console.log("Access token exists?", Boolean(accessToken?.token));

	const drive = google.drive({ version: "v3" });

	const response = await drive.files.list({
		auth,
		pageSize: 10,
		fields: "files(id,name,mimeType,modifiedTime)",
	});

	console.log("OK. Files:", response.data.files ?? []);
}

/**
 * Executa o script e trata erros não capturados.
 */
main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});