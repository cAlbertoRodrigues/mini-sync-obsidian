export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class RemoteRateLimitedError extends Error {
  constructor(message: string, public retryAfterSeconds?: number, public cause?: unknown) {
    super(message);
    this.name = "RemoteRateLimitedError";
  }
}

export class RemoteServerError extends Error {
  constructor(message: string, public statusCode?: number, public cause?: unknown) {
    super(message);
    this.name = "RemoteServerError";
  }
}
