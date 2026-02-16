function isObject(v) {
    return typeof v === "object" && v !== null;
}
export function defaultNetworkRetryPolicy() {
    return {
        maxAttempts: 5,
        baseDelayMs: 300,
        maxDelayMs: 6000,
        jitterRatio: 0.2,
        shouldRetry: (err) => {
            // node-fetch/undici/axios costumam dar "code" em erros de rede:
            if (isObject(err) && typeof err["code"] === "string") {
                const code = err["code"];
                return [
                    "ECONNRESET",
                    "ETIMEDOUT",
                    "EAI_AGAIN",
                    "ENOTFOUND",
                    "ECONNREFUSED",
                    "EPIPE",
                ].includes(code);
            }
            // Se teu adapter lança algo com statusCode (HTTP)
            if (isObject(err) && typeof err["statusCode"] === "number") {
                const s = err["statusCode"];
                // 408, 429 e 5xx = normalmente transient
                return s === 408 || s === 429 || (s >= 500 && s <= 599);
            }
            return false;
        },
    };
}
