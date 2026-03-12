import type { RetryPolicy, Sleeper } from "../ports/retry-policy";

/**
 * Calcula o delay entre tentativas utilizando backoff exponencial
 * com jitter.
 *
 * A fórmula base é:
 *
 * ```
 * delay = baseDelay * 2^(attempt-1)
 * ```
 *
 * O valor é limitado por `maxDelayMs` e recebe jitter aleatório
 * para evitar sincronização simultânea de múltiplos clientes.
 *
 * @param policy Política de retry configurada.
 * @param attempt Número da tentativa atual (1-based).
 * @returns Delay em milissegundos.
 */
function calcDelayMs(policy: RetryPolicy, attempt: number) {
	const exp = policy.baseDelayMs * 2 ** (attempt - 1);
	const capped = Math.min(exp, policy.maxDelayMs);

	const jitter = capped * policy.jitterRatio;
	const rand = (Math.random() * 2 - 1) * jitter;

	return Math.max(0, Math.round(capped + rand));
}

/**
 * Executa uma operação assíncrona com política de retry.
 *
 * A função tenta executar `fn` e, caso ocorra um erro considerado
 * retryable pela política, aguarda um tempo calculado e tenta
 * novamente até atingir o número máximo de tentativas.
 *
 * O delay entre tentativas segue uma estratégia de backoff
 * exponencial com jitter.
 *
 * @typeParam T Tipo retornado pela operação.
 *
 * @param fn Função assíncrona que executa a operação.
 * @param policy Política de retry utilizada.
 * @param sleep Função responsável por aguardar o delay entre tentativas.
 *
 * @returns Resultado da operação quando bem sucedida.
 *
 * @throws O erro original quando:
 * - não é considerado retryable
 * - o número máximo de tentativas é atingido
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	policy: RetryPolicy,
	sleep: Sleeper,
): Promise<T> {
	let lastErr: unknown;

	for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;

			const retryable = policy.shouldRetry(err);
			const isLast = attempt === policy.maxAttempts;

			if (!retryable || isLast) {
				throw err;
			}

			const delay = calcDelayMs(policy, attempt);

			await sleep(delay);
		}
	}

	// nunca deve ocorrer, mas satisfaz o TypeScript
	throw lastErr;
}
