export type SnapshotManifestFile = {
  path: string;                 // path relativo ao vault (posix)
  sha256: string;               // hash do conteúdo
  sizeBytes: number;
  mtimeMs: number;

  // Se texto e pequeno, podemos inline para bootstrap rápido:
  inlineTextUtf8?: string;

  // Se binário (ou grande), referenciamos blob por hash:
  blobSha256?: string;
};

export type SnapshotManifest = {
  id: string;
  vaultId: string;
  createdAtIso: string;
  files: SnapshotManifestFile[];
};