import fs from "node:fs/promises";
import path from "node:path";

export class NodeBlobStore {
  private blobsDir(vaultRootAbs: string) {
    return path.join(vaultRootAbs, ".mini-sync", "blobs");
  }

  private blobPath(vaultRootAbs: string, sha256: string) {
    return path.join(this.blobsDir(vaultRootAbs), sha256);
  }

  async has(vaultRootAbs: string, sha256: string): Promise<boolean> {
    try {
      await fs.stat(this.blobPath(vaultRootAbs, sha256));
      return true;
    } catch {
      return false;
    }
  }

  async put(vaultRootAbs: string, sha256: string, data: Buffer): Promise<void> {
    await fs.mkdir(this.blobsDir(vaultRootAbs), { recursive: true });
    await fs.writeFile(this.blobPath(vaultRootAbs, sha256), data);
  }

  async get(vaultRootAbs: string, sha256: string): Promise<Buffer> {
    return fs.readFile(this.blobPath(vaultRootAbs, sha256));
  }
}