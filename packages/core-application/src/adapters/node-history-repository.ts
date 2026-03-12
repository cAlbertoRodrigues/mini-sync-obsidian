import fs from "node:fs/promises";
import path from "node:path";

import type { HistoryRepository } from "../ports/history-repository";
import type { HistoryEvent } from "../value-objects/history-event";

/**
 * Implementação local de `HistoryRepository` baseada em filesystem.
 *
 * Os eventos são armazenados em arquivos JSONL organizados por dia:
 *
 * ```txt
 * <vaultRoot>/.mini-sync/history/
 *   YYYY-MM-DD.jsonl
 * ```
 *
 * Cada linha do arquivo representa um evento de histórico serializado.
 */
export class NodeHistoryRepository implements HistoryRepository {
  /**
   * Retorna o diretório base onde os arquivos de histórico são armazenados.
   *
   * @param rootDir Caminho absoluto da raiz do vault.
   * @returns Caminho absoluto da pasta de histórico.
   */
  private getBaseDir(rootDir: string) {
    return path.join(rootDir, ".mini-sync", "history");
  }

  /**
   * Garante que a estrutura de diretórios do histórico exista.
   *
   * @param rootDir Caminho absoluto da raiz do vault.
   */
  async ensureStructure(rootDir: string): Promise<void> {
    const base = this.getBaseDir(rootDir);
    await fs.mkdir(base, { recursive: true });
  }

  /**
   * Adiciona um evento ao histórico local.
   *
   * O evento é serializado como JSON e adicionado ao arquivo
   * correspondente ao dia em que ocorreu.
   *
   * @param rootDir Caminho absoluto da raiz do vault.
   * @param event Evento de histórico a ser registrado.
   */
  async append(rootDir: string, event: HistoryEvent): Promise<void> {
    await this.ensureStructure(rootDir);

    const date = event.occurredAtIso.slice(0, 10); // YYYY-MM-DD

    const filePath = path.join(
      this.getBaseDir(rootDir),
      `${date}.jsonl`,
    );

    const line = `${JSON.stringify(event)}\n`;

    await fs.appendFile(filePath, line, "utf-8");
  }
}