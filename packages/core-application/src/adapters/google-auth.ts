import fs from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

/**
 * Estrutura persistida de tokens OAuth do Google.
 */
type GoogleTokens = {
	access_token?: string;
	refresh_token?: string;
	scope?: string;
	token_type?: string;
	expiry_date?: number;
};

/**
 * Escopos utilizados para autenticação no Google Drive.
 */
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

/**
 * Representa a estrutura esperada do bloco `installed` ou `web`
 * dentro do arquivo de credenciais OAuth do Google.
 */
type GoogleInstalledCredentials = {
	client_id?: string;
	client_secret?: string;
	redirect_uris?: string[];
};

/**
 * Verifica se um arquivo existe.
 *
 * @param p Caminho absoluto do arquivo.
 * @returns `true` quando o arquivo existe.
 */
async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Verifica se um valor é um objeto simples indexável.
 *
 * @param value Valor a ser verificado.
 * @returns `true` quando o valor é um objeto não nulo.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Retorna o valor como string quando possível.
 *
 * @param value Valor de entrada.
 * @returns String válida ou `undefined`.
 */
function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * Retorna o valor como número quando possível.
 *
 * @param value Valor de entrada.
 * @returns Número válido ou `undefined`.
 */
function getNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

/**
 * Retorna o valor como array de strings quando possível.
 *
 * @param value Valor de entrada.
 * @returns Lista de strings válida ou `undefined`.
 */
function getStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

/**
 * Normaliza uma estrutura arbitrária para o formato esperado
 * de tokens OAuth do Google.
 *
 * @param tokens Valor bruto recebido de disco ou da API.
 * @returns Estrutura normalizada de tokens.
 */
function normalizeTokens(tokens: unknown): GoogleTokens {
	if (!isRecord(tokens)) return {};

	return {
		access_token: getString(tokens.access_token),
		refresh_token: getString(tokens.refresh_token),
		scope: getString(tokens.scope),
		token_type: getString(tokens.token_type),
		expiry_date: getNumber(tokens.expiry_date),
	};
}

/**
 * Normaliza a estrutura de credenciais OAuth do Google.
 *
 * @param value Valor bruto do bloco `installed` ou `web`.
 * @returns Credenciais normalizadas.
 */
function normalizeInstalledCredentials(
	value: unknown,
): GoogleInstalledCredentials {
	if (!isRecord(value)) return {};

	return {
		client_id: getString(value.client_id),
		client_secret: getString(value.client_secret),
		redirect_uris: getStringArray(value.redirect_uris),
	};
}

/**
 * Responsável por autenticar o aplicativo com Google OAuth e
 * persistir os tokens localmente.
 */
export class GoogleAuth {
	/**
	 * Caminho do arquivo onde os tokens OAuth são persistidos.
	 */
	private tokenPath: string;

	/**
	 * Caminho absoluto do arquivo de credenciais OAuth.
	 */
	private credentialsPath: string;

	/**
	 * Cria uma nova instância do autenticador Google.
	 *
	 * @param opts Configuração de paths utilizados pela autenticação.
	 * @param opts.tokenDirAbs Diretório absoluto onde os tokens serão salvos.
	 * @param opts.credentialsPathAbs Caminho absoluto do arquivo de credenciais OAuth.
	 */
	constructor(opts: { tokenDirAbs: string; credentialsPathAbs: string }) {
		this.tokenPath = path.join(opts.tokenDirAbs, "google.tokens.json");
		this.credentialsPath = opts.credentialsPathAbs;
	}

	/**
	 * Retorna um cliente OAuth autenticado e pronto para uso.
	 *
	 * @returns Cliente OAuth autenticado.
	 */
	async getAuthorizedClient(): Promise<OAuth2Client> {
		const credentialsRaw = await fs.readFile(this.credentialsPath, "utf-8");
		const credentialsUnknown: unknown = JSON.parse(credentialsRaw);

		const credentials = isRecord(credentialsUnknown) ? credentialsUnknown : {};
		const installed = normalizeInstalledCredentials(
			credentials.installed ?? credentials.web,
		);

		const clientId = installed.client_id;
		const clientSecret = installed.client_secret;
		const redirectUris = installed.redirect_uris;

		if (!clientId || !clientSecret) {
			throw new Error(
				'Credenciais inválidas. Esperado JSON com "installed.client_id" e "installed.client_secret".',
			);
		}

		const oAuth2Client: OAuth2Client = new google.auth.OAuth2(
			clientId,
			clientSecret,
			redirectUris?.[0] ?? "http://localhost",
		);

		/**
		 * Registra persistência automática de novos tokens emitidos pelo cliente.
		 *
		 * @param client Cliente OAuth autenticado.
		 */
		const attachTokenSaver = (client: OAuth2Client) => {
			client.on("tokens", async (tokens) => {
				const current = (await this.safeReadTokens()) ?? {};
				const merged = normalizeTokens({ ...current, ...tokens });
				await this.saveTokens(merged);
			});
		};

		if (await fileExists(this.tokenPath)) {
			const tokenRaw = await fs.readFile(this.tokenPath, "utf-8");
			const tokens = normalizeTokens(JSON.parse(tokenRaw));

			oAuth2Client.setCredentials(tokens);
			await oAuth2Client.getAccessToken();

			attachTokenSaver(oAuth2Client);
			return oAuth2Client;
		}

		type AuthenticateOptions = Parameters<typeof authenticate>[0];

		const authedClient = await authenticate({
			keyfilePath: this.credentialsPath,
			scopes: SCOPES,
			accessType: "offline",
			prompt: "consent",
		} as unknown as AuthenticateOptions);

		const authed = authedClient as unknown as OAuth2Client;

		await authed.getAccessToken();

		const tokens = normalizeTokens(authed.credentials);
		await this.saveTokens(tokens);
		attachTokenSaver(authed);

		return authed;
	}

	/**
	 * Lê os tokens persistidos localmente, quando existirem.
	 *
	 * @returns Tokens salvos ou `null` em caso de ausência ou erro.
	 */
	private async safeReadTokens(): Promise<GoogleTokens | null> {
		try {
			const raw = await fs.readFile(this.tokenPath, "utf-8");
			return normalizeTokens(JSON.parse(raw));
		} catch {
			return null;
		}
	}

	/**
	 * Persiste os tokens OAuth em disco.
	 *
	 * @param tokens Tokens autenticados a serem salvos.
	 */
	private async saveTokens(tokens: GoogleTokens): Promise<void> {
		await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
		await fs.writeFile(
			this.tokenPath,
			JSON.stringify(tokens, null, 2),
			"utf-8",
		);
	}

	/**
	 * Remove os tokens persistidos localmente.
	 *
	 * Esse método força nova autenticação no próximo uso.
	 */
	async logout(): Promise<void> {
		try {
			await fs.unlink(this.tokenPath);
		} catch {
			//
		}
	}
}
