/**
 * Define o contrato de um sistema de logging utilizado pela aplicação.
 *
 * Implementações podem direcionar logs para console, arquivos,
 * serviços externos ou sistemas de observabilidade.
 */
export interface Logger {
  /**
   * Registra uma mensagem informativa.
   *
   * @param message Mensagem principal do log.
   * @param meta Dados adicionais opcionais associados ao evento.
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * Registra uma mensagem de aviso.
   *
   * Indica uma situação inesperada que não interrompe a execução.
   *
   * @param message Mensagem principal do log.
   * @param meta Dados adicionais opcionais associados ao evento.
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * Registra uma mensagem de erro.
   *
   * Usado para falhas que podem impactar o funcionamento da aplicação.
   *
   * @param message Mensagem principal do log.
   * @param meta Dados adicionais opcionais associados ao evento.
   */
  error(message: string, meta?: Record<string, unknown>): void;
}