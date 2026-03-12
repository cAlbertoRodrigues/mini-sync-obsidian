/**
 * Representa um erro de rede durante operações de sincronização.
 *
 * Esse erro normalmente indica falhas transitórias como:
 * - perda de conexão
 * - timeout de rede
 * - falha DNS
 *
 * Pode ser utilizado junto com `RetryPolicy` para determinar
 * se a operação deve ser tentada novamente.
 */
export class NetworkError extends Error {
	/**
	 * Cria um novo erro de rede.
	 *
	 * @param message Mensagem descritiva do erro.
	 * @param cause Erro original que causou a falha.
	 */
	constructor(message: string, public cause?: unknown) {
		super(message);
		this.name = "NetworkError";
	}
}

/**
 * Representa um erro de limitação de taxa imposto pelo servidor remoto.
 *
 * Esse erro normalmente ocorre quando o backend remoto
 * restringe o número de requisições permitidas.
 *
 * Exemplos típicos:
 * - HTTP 429
 * - quotas de API
 */
export class RemoteRateLimitedError extends Error {
	/**
	 * Cria um erro de limitação de taxa.
	 *
	 * @param message Mensagem descritiva do erro.
	 * @param retryAfterSeconds Tempo sugerido antes de tentar novamente.
	 * @param cause Erro original que causou a falha.
	 */
	constructor(
		message: string,
		public retryAfterSeconds?: number,
		public cause?: unknown,
	) {
		super(message);
		this.name = "RemoteRateLimitedError";
	}
}

/**
 * Representa um erro interno retornado pelo servidor remoto.
 *
 * Geralmente associado a falhas HTTP como:
 * - 500 Internal Server Error
 * - 502 Bad Gateway
 * - 503 Service Unavailable
 */
export class RemoteServerError extends Error {
	/**
	 * Cria um erro de servidor remoto.
	 *
	 * @param message Mensagem descritiva do erro.
	 * @param statusCode Código HTTP retornado pelo servidor.
	 * @param cause Erro original que causou a falha.
	 */
	constructor(
		message: string,
		public statusCode?: number,
		public cause?: unknown,
	) {
		super(message);
		this.name = "RemoteServerError";
	}
}