import { createHash } from "crypto";
import { createReadStream } from "fs";
export class NodeFileHasher {
    async hashFile(absolutePath) {
        const algo = "sha256";
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
