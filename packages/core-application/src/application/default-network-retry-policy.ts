import type { RetryPolicy } from "../ports/retry-policy";

/**
 * Verifica se um valor é um objeto simples.
 *
 * @param value Valor a verificar.
 * @returns `true` quando o valor é um objeto não nulo.
 */
function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Cria a política padrão de retry para operações de rede.
 *
 * Essa política é projetada para lidar com falhas transitórias
 * comuns em comunicação de rede, como:
 *
 * - resets de conexão
 * - timeouts
 * - falhas DNS temporárias
 * - erros HTTP temporários (429, 5xx)
 *
 * A política utiliza backoff exponencial com jitter para evitar
 * explosões de requisições simultâneas.
 *
 * @returns Configuração padrão de `RetryPolicy`.
 */
export function defaultNetworkRetryPolicy(): RetryPolicy {
	return {
		/**
		 * Número máximo de tentativas antes de falhar definitivamente.
		 */
		maxAttempts: 5,

		/**
		 * Delay inicial entre tentativas.
		 */
		baseDelayMs: 300,

		/**
		 * Delay máximo permitido entre tentativas.
		 */
		maxDelayMs: 6000,

		/**
		 * Percentual de jitter aplicado ao delay.
		 */
		jitterRatio: 0.2,

		/**
		 * Determina se um erro é elegível para retry.
		 *
		 * @param err Erro capturado na operação.
		 * @returns `true` quando a operação deve ser tentada novamente.
		 */
		shouldRetry: (err) => {
			if (isObject(err) && typeof err.code === "string") {
				const code = err.code;

				return [
					"ECONNRESET",
					"ETIMEDOUT",
					"EAI_AGAIN",
					"ENOTFOUND",
					"ECONNREFUSED",
					"EPIPE",
				].includes(code);
			}

			if (isObject(err) && typeof err.statusCode === "number") {
				const statusCode = err.statusCode;

				return (
					statusCode === 408 ||
					statusCode === 429 ||
					(statusCode >= 500 && statusCode <= 599)
				);
			}

			return false;
		},
	};
}