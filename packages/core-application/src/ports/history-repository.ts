import type { HistoryEvent } from "../value-objects/history-event";

/**
 * Define o contrato responsável por persistir eventos de histórico.
 *
 * Implementações dessa interface armazenam eventos que representam
 * alterações ocorridas no vault, permitindo reconstruir o estado
 * ou sincronizar mudanças com outros dispositivos.
 */
export interface HistoryRepository {
  /**
   * Garante que a estrutura de armazenamento necessária exista.
   *
   * Pode criar diretórios ou arquivos iniciais necessários para
   * registrar eventos de histórico.
   *
   * @param rootDir Caminho absoluto da raiz do vault.
   */
  ensureStructure(rootDir: string): Promise<void>;

  /**
   * Persiste um novo evento de histórico.
   *
   * @param rootDir Caminho absoluto da raiz do vault.
   * @param event Evento de histórico a ser armazenado.
   */
  append(rootDir: string, event: HistoryEvent): Promise<void>;
}