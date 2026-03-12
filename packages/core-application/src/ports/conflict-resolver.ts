import type { Conflict } from "@mini-sync/core-domain";

/**
 * Estratégia usada para resolver um conflito detectado durante a sincronização.
 *
 * - `keep_local`: mantém a versão local do arquivo
 * - `keep_remote`: mantém a versão remota do arquivo
 */
export type ConflictDecisionStrategy = "keep_local" | "keep_remote";

/**
 * Representa a decisão aplicada para resolver um conflito específico.
 */
export interface ConflictDecision {
  /**
   * Caminho relativo do arquivo em conflito.
   */
  path: string;

  /**
   * Estratégia escolhida para resolver o conflito.
   */
  strategy: ConflictDecisionStrategy;
}

/**
 * Define o contrato responsável por resolver conflitos de sincronização.
 *
 * Implementações podem utilizar diferentes estratégias, como:
 * - resolução automática
 * - decisão via CLI
 * - decisão via interface gráfica
 */
export interface ConflictResolver {
  /**
   * Resolve uma lista de conflitos detectados durante o processo de sincronização.
   *
   * @param conflicts Lista de conflitos detectados.
   * @returns Decisões associadas a cada conflito.
   */
  resolve(conflicts: Conflict[]): Promise<ConflictDecision[]>;
}