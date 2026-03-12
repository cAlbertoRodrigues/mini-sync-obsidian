/**
 * Abstração de fonte de tempo usada pelo sistema.
 *
 * Permite desacoplar o acesso ao relógio do ambiente de execução,
 * facilitando testes e controle determinístico de tempo.
 */
export interface Clock {
  /**
   * Retorna o timestamp atual em milissegundos desde o Unix Epoch.
   *
   * @returns Tempo atual em milissegundos.
   */
  nowMs(): number;
}