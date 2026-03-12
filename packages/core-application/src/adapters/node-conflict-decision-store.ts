import fs from "node:fs/promises";
import path from "node:path";

import type {
  ConflictDecision,
  ConflictDecisionStore,
} from "../ports/conflict-decision-store";

/**
 * Estrutura persistida em disco para armazenar decisões de conflito.
 */
type DecisionsFile = {
  /**
   * Lista de decisões registradas para conflitos de arquivos.
   */
  decisions: ConflictDecision[];
};

/**
 * Implementação local de `ConflictDecisionStore` baseada em filesystem.
 *
 * As decisões são persistidas em:
 *
 * ```txt
 * <vaultRootAbs>/.mini-sync/conflicts/decisions.json
 * ```
 *
 * Cada decisão representa a escolha do usuário ou do sistema
 * sobre como resolver um conflito específico.
 */
export class NodeConflictDecisionStore implements ConflictDecisionStore {
  /**
   * Retorna o caminho absoluto do arquivo de decisões de conflito.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @returns Caminho absoluto do arquivo `decisions.json`.
   */
  private decisionsFile(vaultRootAbs: string) {
    return path.join(vaultRootAbs, ".mini-sync", "conflicts", "decisions.json");
  }

  /**
   * Carrega as decisões persistidas para um vault.
   *
   * Caso o arquivo ainda não exista ou não possa ser lido,
   * retorna uma estrutura vazia.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @returns Estrutura contendo as decisões registradas.
   */
  private async load(vaultRootAbs: string): Promise<DecisionsFile> {
    const file = this.decisionsFile(vaultRootAbs);

    try {
      const raw = await fs.readFile(file, "utf-8");
      return JSON.parse(raw) as DecisionsFile;
    } catch {
      return { decisions: [] };
    }
  }

  /**
   * Persiste em disco a estrutura de decisões de conflito.
   *
   * O diretório é criado automaticamente quando necessário.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @param data Estrutura de decisões a ser salva.
   */
  private async save(vaultRootAbs: string, data: DecisionsFile): Promise<void> {
    const dir = path.dirname(this.decisionsFile(vaultRootAbs));

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.decisionsFile(vaultRootAbs),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }

  /**
   * Retorna a decisão registrada para um caminho específico.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @param pathRel Caminho relativo do arquivo em conflito.
   * @returns Decisão registrada ou `null` quando não existe.
   */
  async get(
    vaultRootAbs: string,
    pathRel: string,
  ): Promise<ConflictDecision | null> {
    const data = await this.load(vaultRootAbs);
    return data.decisions.find((d) => d.path === pathRel) ?? null;
  }

  /**
   * Registra ou substitui a decisão de conflito de um arquivo.
   *
   * Se já existir uma decisão para o mesmo caminho, ela será removida
   * antes da nova versão ser salva.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @param decision Decisão a ser registrada.
   */
  async set(vaultRootAbs: string, decision: ConflictDecision): Promise<void> {
    const data = await this.load(vaultRootAbs);
    const filtered = data.decisions.filter((d) => d.path !== decision.path);

    filtered.push(decision);

    await this.save(vaultRootAbs, { decisions: filtered });
  }

  /**
   * Remove a decisão registrada para um arquivo específico.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @param pathRel Caminho relativo do arquivo.
   */
  async remove(vaultRootAbs: string, pathRel: string): Promise<void> {
    const data = await this.load(vaultRootAbs);
    const filtered = data.decisions.filter((d) => d.path !== pathRel);

    await this.save(vaultRootAbs, { decisions: filtered });
  }

  /**
   * Lista todas as decisões de conflito registradas para o vault.
   *
   * @param vaultRootAbs Caminho absoluto da raiz do vault.
   * @returns Lista completa de decisões.
   */
  async list(vaultRootAbs: string): Promise<ConflictDecision[]> {
    const data = await this.load(vaultRootAbs);
    return data.decisions;
  }
}