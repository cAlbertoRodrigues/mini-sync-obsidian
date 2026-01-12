export type RetryContext = {
  attempt: number;
  startedAt: number;
  lastError?: unknown;
};

export type RetryPolicy = {
  maxAttempts: number;            // ex: 5
  baseDelayMs: number;            // ex: 300
  maxDelayMs: number;             // ex: 5000
  jitterRatio: number;            // ex: 0.2 (20%)
  shouldRetry: (err: unknown) => boolean;
};

export type Sleeper = (ms: number) => Promise<void>;
