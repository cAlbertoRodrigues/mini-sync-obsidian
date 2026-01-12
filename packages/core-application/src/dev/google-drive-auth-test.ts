import path from "path";
import { GoogleAuth } from "../adapters/google-auth";
import { google } from "googleapis";

async function main() {
  const vaultAbs = path.resolve(process.argv[2] ?? "");
  const tokenDirAbs = path.join(vaultAbs, ".mini-sync", "secrets");
  const credentialsPathAbs = path.join(tokenDirAbs, "google.credentials.json");

  const ga = new GoogleAuth({ tokenDirAbs, credentialsPathAbs });
  const auth = await ga.getAuthorizedClient();

  // ✅ Debug 1: o auth tem método de headers?
  console.log("Auth type:", (auth as any)?.constructor?.name);
  console.log("Has getRequestHeaders?", typeof (auth as any)?.getRequestHeaders);

  // ✅ Debug 2: existe authorization?
  const hdrs = await auth.getRequestHeaders();
  console.log("Authorization header exists?", Boolean((hdrs as any).authorization));

  // ✅ força token (e mostra se veio)
  const at = await auth.getAccessToken();
  console.log("Access token exists?", Boolean(at?.token));

  // ✅ Drive client
  const drive = google.drive({ version: "v3" });

  // ✅ MAIS CONFIÁVEL: passa auth POR REQUEST
  const res = await drive.files.list({
    auth,
    pageSize: 10,
    fields: "files(id,name,mimeType,modifiedTime)",
  });

  console.log("OK. Files:", res.data.files ?? []);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
