import fs from "node:fs/promises";
import path from "node:path";

import type { FileSyncState } from "../value-objects/file-sync-state";

/**
 * Estrutura persistida em disco contendo o estado de sincronização
 * de todos os arquivos do vault.
 */
type StateFile = {
  /**
   * Mapa indexado pelo caminho relativo do arquivo.
   */
  files: Record<string, FileSyncState>;
};

/**
 * Armazenamento local do estado de sincronização de arquivos.
 *
 * Os dados são persistidos em:
 *
 * ```txt
 * <vaultRoot>/.mini-sync/state/file-sync-state.json
 * ```
 *
 * Esse estado é utilizado para rastrear o relacionamento entre
 * arquivos locais, blobs e estado remoto durante o processo
 * de sincronização.
 */
export class NodeSyncStateStore {
  /**
   * Retorna o caminho do arquivo de estado persistido.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @returns Caminho absoluto do arquivo de estado.
   */
  private filePath(vaultRoot: string) {
    return path.join(vaultRoot, ".mini-sync", "state", "file-sync-state.json");
  }

  /**
   * Carrega todo o estado de sincronização persistido.
   *
   * Caso o arquivo ainda não exista ou não possa ser lido,
   * retorna um mapa vazio.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @returns Mapa contendo o estado de todos os arquivos.
   */
  async loadAll(vaultRoot: string): Promise<Record<string, FileSyncState>> {
    const fp = this.filePath(vaultRoot);

    try {
      const raw = await fs.readFile(fp, "utf-8");
      const parsed = JSON.parse(raw) as StateFile;
      return parsed.files ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Persiste todo o estado de sincronização em disco.
   *
   * O diretório necessário é criado automaticamente
   * quando não existir.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @param files Mapa de estados a ser salvo.
   */
  async saveAll(
    vaultRoot: string,
    files: Record<string, FileSyncState>,
  ): Promise<void> {
    const fp = this.filePath(vaultRoot);

    await fs.mkdir(path.dirname(fp), { recursive: true });

    await fs.writeFile(
      fp,
      JSON.stringify({ files }, null, 2),
      "utf-8",
    );
  }

  /**
   * Recupera o estado de sincronização de um arquivo específico.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @param filePathKey Caminho relativo do arquivo.
   * @returns Estado do arquivo ou `null` quando não existir.
   */
  async get(
    vaultRoot: string,
    filePathKey: string,
  ): Promise<FileSyncState | null> {
    const all = await this.loadAll(vaultRoot);
    return all[filePathKey] ?? null;
  }

  /**
   * Insere ou atualiza o estado de sincronização de um arquivo.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @param state Estado de sincronização do arquivo.
   */
  async upsert(vaultRoot: string, state: FileSyncState): Promise<void> {
    const all = await this.loadAll(vaultRoot);

    all[state.path] = state;

    await this.saveAll(vaultRoot, all);
  }

  /**
   * Remove o estado de sincronização de um arquivo.
   *
   * @param vaultRoot Caminho absoluto da raiz do vault.
   * @param filePathKey Caminho relativo do arquivo.
   */
  async remove(vaultRoot: string, filePathKey: string): Promise<void> {
    const all = await this.loadAll(vaultRoot);

    delete all[filePathKey];

    await this.saveAll(vaultRoot, all);
  }
}