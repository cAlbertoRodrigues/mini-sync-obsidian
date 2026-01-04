import { createHash } from "crypto";
import { createReadStream } from "fs";
import type { FileHasher, FileHash } from "../ports/file-hasher";

export class NodeFileHasher implements FileHasher {
  async hashFile(absolutePath: string): Promise<FileHash> {
    const algo: FileHash["algorithm"] = "sha256";

    return new Promise((resolve, reject) => {
      const hash = createHash(algo);
      const stream = createReadStream(absolutePath);

      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        resolve({ algorithm: algo, value: hash.digest("hex") });
      });
    });
  }
}
