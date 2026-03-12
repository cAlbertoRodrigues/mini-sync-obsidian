/**
 * Estratégia usada para resolver um conflito de sincronização.
 *
 * - `local`: mantém a versão local do arquivo
 * - `remote`: mantém a versão remota do arquivo
 */
export type ConflictResolutionStrategy = "local" | "remote";

/**
 * Representa uma decisão persistida para resolver um conflito específico.
 */
export type ConflictDecision = {
  /**
   * Caminho relativo do arquivo dentro do vault.
   */
  path: string;

  /**
   * Estratégia escolhida para resolver o conflito.
   */
  strategy: ConflictResolutionStrategy;

  /**
   * Timestamp ISO indicando quando a decisão foi tomada.
   */
  decidedAtIso: string;
};

/**
 * Armazena decisões de resolução de conflitos associadas a um vault.
 *
 * Implementações dessa interface são responsáveis por persistir,
 * recuperar e listar decisões tomadas pelo usuário ou pela CLI.
 */
export interface ConflictDecisionStore {
  /**
   * Obtém a decisão associada a um arquivo específico.
   *
   * @param vaultRootAbs Caminho absoluto do vault.
   * @param path Caminho relativo do arquivo.
   * @returns Decisão registrada ou `null` quando inexistente.
   */
  get(vaultRootAbs: string, path: string): Promise<ConflictDecision | null>;

  /**
   * Persiste ou atualiza uma decisão de conflito.
   *
   * @param vaultRootAbs Caminho absoluto do vault.
   * @param decision Decisão a ser armazenada.
   */
  set(vaultRootAbs: string, decision: ConflictDecision): Promise<void>;

  /**
   * Remove a decisão associada a um arquivo.
   *
   * @param vaultRootAbs Caminho absoluto do vault.
   * @param path Caminho relativo do arquivo.
   */
  remove(vaultRootAbs: string, path: string): Promise<void>;

  /**
   * Lista todas as decisões registradas para o vault.
   *
   * @param vaultRootAbs Caminho absoluto do vault.
   * @returns Lista de decisões persistidas.
   */
  list(vaultRootAbs: string): Promise<ConflictDecision[]>;
}