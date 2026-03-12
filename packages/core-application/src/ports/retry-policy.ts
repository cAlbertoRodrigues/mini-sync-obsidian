/**
 * Contexto fornecido durante a execução de uma operação com retry.
 */
export type RetryContext = {
  /**
   * Número da tentativa atual (iniciando em 1).
   */
  attempt: number;

  /**
   * Timestamp em milissegundos indicando quando o processo de retry começou.
   */
  startedAt: number;

  /**
   * Último erro capturado durante a execução.
   */
  lastError?: unknown;
};

/**
 * Define a política de repetição (retry) utilizada para operações que podem falhar.
 */
export type RetryPolicy = {
  /**
   * Número máximo de tentativas permitidas.
   */
  maxAttempts: number;

  /**
   * Delay base utilizado para calcular o backoff entre tentativas.
   */
  baseDelayMs: number;

  /**
   * Delay máximo permitido entre tentativas.
   */
  maxDelayMs: number;

  /**
   * Proporção de jitter aplicada ao delay para evitar sincronização entre clientes.
   */
  jitterRatio: number;

  /**
   * Função que determina se um erro deve ou não disparar uma nova tentativa.
   *
   * @param err Erro capturado na tentativa atual.
   */
  shouldRetry: (err: unknown) => boolean;
};

/**
 * Função responsável por suspender a execução por um período de tempo.
 */
export type Sleeper = (ms: number) => Promise<void>;