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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function getNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function getStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
}

// normaliza null -> undefined (entrada pode ser qualquer coisa)
function normalizeTokens(t: unknown): GoogleTokens {
  if (!isRecord(t)) return {};

  return {
    access_token: getString(t["access_token"]),
    refresh_token: getString(t["refresh_token"]),
    scope: getString(t["scope"]),
    token_type: getString(t["token_type"]),
    expiry_date: getNumber(t["expiry_date"]),
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
    const credsUnknown: unknown = JSON.parse(credsRaw);

    const creds = isRecord(credsUnknown) ? credsUnknown : {};
    const installed = (isRecord(creds["installed"]) && creds["installed"]) ||
      (isRecord(creds["web"]) && creds["web"]) ||
      {};

    const client_id = getString((installed as Record<string, unknown>)["client_id"]);
    const client_secret = getString((installed as Record<string, unknown>)["client_secret"]);
    const redirect_uris = getStringArray((installed as Record<string, unknown>)["redirect_uris"]);

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

    type AuthenticateOptions = Parameters<typeof authenticate>[0];

    const authedClient = await authenticate(
      {
        keyfilePath: this.credentialsPath,
        scopes: SCOPES,

        // força refresh_token e tela de consentimento (runtime ok, types não conhecem)
        accessType: "offline",
        prompt: "consent",
      } as unknown as AuthenticateOptions
    );


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
