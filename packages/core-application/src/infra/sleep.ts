/**
 * Suspende a execução assíncrona por um período de tempo.
 *
 * Útil para implementar backoff, throttling ou pausas entre operações
 * que dependem de recursos externos como rede ou filesystem.
 *
 * @param ms Tempo de espera em milissegundos.
 * @returns Promise resolvida após o tempo especificado.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));