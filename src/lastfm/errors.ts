/** Last.fm API error codes that are worth retrying (backend error, temporary, rate limit). */
const RETRYABLE_CODES = new Set([8, 16, 29]);

export class LastfmError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = 'LastfmError';
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /** code 6 = "User not found" / invalid parameters for the entity looked up */
  get notFound(): boolean {
    return this.code === 6;
  }
}
