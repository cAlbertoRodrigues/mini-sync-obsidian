import path from "path";
import fs from "fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
};

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  // Se precisar acesso total ao Drive:
  // "https://www.googleapis.com/auth/drive",
];

async function fileExists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// normaliza null -> undefined
function normalizeTokens(t: any): GoogleTokens {
  return {
    access_token: t?.access_token ?? undefined,
    refresh_token: t?.refresh_token ?? undefined,
    scope: t?.scope ?? undefined,
    token_type: t?.token_type ?? undefined,
    expiry_date: t?.expiry_date ?? undefined,
  };
}

export class GoogleAuth {
  private tokenPath: string;
  private credentialsPath: string;

  constructor(opts: { tokenDirAbs: string; credentialsPathAbs: string }) {
    this.tokenPath = path.join(opts.tokenDirAbs, "google.tokens.json");
    this.credentialsPath = opts.credentialsPathAbs;
  }

  async getAuthorizedClient(): Promise<OAuth2Client> {
    const credsRaw = await fs.readFile(this.credentialsPath, "utf-8");
    const creds = JSON.parse(credsRaw);

    const installed = creds.installed ?? creds.web ?? {};
    const client_id = installed.client_id;
    const client_secret = installed.client_secret;
    const redirect_uris: string[] | undefined = installed.redirect_uris;

    if (!client_id || !client_secret) {
      throw new Error(
        `Credenciais inválidas. Esperado JSON com "installed.client_id" e "installed.client_secret".`
      );
    }

    const oAuth2Client: OAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris?.[0] ?? "http://localhost"
    );

    const attachTokenSaver = (client: OAuth2Client) => {
      client.on("tokens", async (t) => {
        const current = (await this.safeReadTokens()) ?? {};
        const merged = normalizeTokens({ ...current, ...t });
        await this.saveTokens(merged);
      });
    };

    // 1) tenta token salvo
    if (await fileExists(this.tokenPath)) {
      const tokenRaw = await fs.readFile(this.tokenPath, "utf-8");
      const tokens = normalizeTokens(JSON.parse(tokenRaw));

      oAuth2Client.setCredentials(tokens);

      // ✅ garante que existe access_token (usa refresh_token se necessário)
      await oAuth2Client.getAccessToken();

      attachTokenSaver(oAuth2Client);
      return oAuth2Client;
    }

    // 2) primeiro login (abre navegador + redirect local)
    const authedClient = await authenticate({
      keyfilePath: this.credentialsPath,
      scopes: SCOPES,
      // força refresh_token e tela de consentimento
      ...({ accessType: "offline", prompt: "consent" } as any),
    });

    const authed = authedClient as unknown as OAuth2Client;

    // ✅ garante que existe access_token agora
    await authed.getAccessToken();

    const tokens = normalizeTokens(authed.credentials);
    await this.saveTokens(tokens);
    attachTokenSaver(authed);

    return authed;
  }

  private async safeReadTokens(): Promise<GoogleTokens | null> {
    try {
      const raw = await fs.readFile(this.tokenPath, "utf-8");
      return normalizeTokens(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async saveTokens(tokens: GoogleTokens) {
    await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
    await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
  }

  async logout() {
    try {
      await fs.unlink(this.tokenPath);
    } catch {
      // ignore
    }
  }
}
