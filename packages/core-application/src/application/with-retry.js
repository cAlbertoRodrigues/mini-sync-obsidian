function calcDelayMs(policy, attempt) {
    const exp = policy.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exp, policy.maxDelayMs);
    const jitter = capped * policy.jitterRatio;
    const rand = (Math.random() * 2 - 1) * jitter; // [-jitter, +jitter]
    return Math.max(0, Math.round(capped + rand));
}
export async function withRetry(fn, policy, sleep) {
    let lastErr;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const retryable = policy.shouldRetry(err);
            const isLast = attempt === policy.maxAttempts;
            if (!retryable || isLast)
                throw err;
            const delay = calcDelayMs(policy, attempt);
            await sleep(delay);
        }
    }
    // nunca chega aqui, mas TS gosta
    throw lastErr;
}
