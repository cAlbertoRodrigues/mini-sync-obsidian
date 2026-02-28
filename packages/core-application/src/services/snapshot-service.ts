import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeBlobStore } from "../adapters/node-blob-store";
import type { SnapshotManifest, SnapshotManifestFile } from "../value-objects/snapshot-manifest";

const DEFAULT_INLINE_TEXT_MAX = 64 * 1024; // 64KB

function toPosix(p: string) {
  return p.replaceAll("\\", "/");
}

async function walkFiles(rootAbs: string, dirAbs: string, out: string[]) {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    const rel = toPosix(path.relative(rootAbs, abs));

    // ignora internals
    if (rel === ".mini-sync" || rel.startsWith(".mini-sync/")) continue;
    if (rel === ".obsidian" || rel.startsWith(".obsidian/")) continue;

    if (e.isDirectory()) {
      await walkFiles(rootAbs, abs, out);
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
}

function isProbablyTextByExt(relPosix: string) {
  const lower = relPosix.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".csv")
  );
}

export class SnapshotService {
  constructor(
    private readonly hasher = new NodeFileHasher(),
    private readonly blobStore = new NodeBlobStore()
  ) {}

  async createSnapshotManifest(params: {
    vaultRootAbs: string;
    vaultId: string;
    inlineTextMaxBytes?: number;
  }): Promise<SnapshotManifest> {
    const { vaultRootAbs, vaultId } = params;
    const inlineMax = params.inlineTextMaxBytes ?? DEFAULT_INLINE_TEXT_MAX;

    const filesAbs: string[] = [];
    await walkFiles(vaultRootAbs, vaultRootAbs, filesAbs);

    const manifestFiles: SnapshotManifestFile[] = [];

    for (const abs of filesAbs) {
      const rel = toPosix(path.relative(vaultRootAbs, abs));
      const stat = await fs.stat(abs);
      const hash = await this.hasher.hashFile(abs);

      const file: SnapshotManifestFile = {
        path: rel,
        sha256: hash.value,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      };

      // tenta inline se texto e pequeno
      if (isProbablyTextByExt(rel) && stat.size <= inlineMax) {
        try {
          file.inlineTextUtf8 = await fs.readFile(abs, "utf-8");
        } catch {
          // se falhar, cai para blob
          const buf = await fs.readFile(abs);
          await this.blobStore.put(vaultRootAbs, hash.value, buf);
          file.blobSha256 = hash.value;
        }
      } else {
        // binário ou grande => blob
        const buf = await fs.readFile(abs);
        await this.blobStore.put(vaultRootAbs, hash.value, buf);
        file.blobSha256 = hash.value;
      }

      manifestFiles.push(file);
    }

    const id = `snap-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`;

    return {
      id,
      vaultId,
      createdAtIso: new Date().toISOString(),
      files: manifestFiles,
    };
  }
}