import { createHash } from "crypto";
import { createReadStream } from "fs";

import type { FileHash, FileHasher } from "../ports/file-hasher";

/**
 * Implementação de `FileHasher` baseada no filesystem do Node.js.
 *
 * Essa classe calcula o hash criptográfico de arquivos utilizando
 * streams, evitando carregar arquivos grandes inteiros na memória.
 *
 * Atualmente o algoritmo utilizado é `sha256`.
 */
export class NodeFileHasher implements FileHasher {
	/**
	 * Calcula o hash de um arquivo no filesystem.
	 *
	 * O arquivo é processado em streaming para suportar arquivos
	 * grandes com baixo consumo de memória.
	 *
	 * @param absolutePath Caminho absoluto do arquivo a ser processado.
	 * @returns Estrutura contendo o algoritmo utilizado e o valor do hash.
	 */
	async hashFile(absolutePath: string): Promise<FileHash> {
		const algo: FileHash["algorithm"] = "sha256";

		return new Promise((resolve, reject) => {
			const hash = createHash(algo);
			const stream = createReadStream(absolutePath);

			stream.on("data", (chunk) => hash.update(chunk));
			stream.on("error", reject);

			stream.on("end", () => {
				resolve({
					algorithm: algo,
					value: hash.digest("hex"),
				});
			});
		});
	}
}
