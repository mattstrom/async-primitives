import { delay } from './utils/delay.ts';

export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	jitter?: boolean;
	shouldRetry?: (error: Error, attempt: number) => boolean;
}

export function exponentialBackoff(
	value: number,
	options: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitter'>,
): number {
	const baseDelay = Math.max(1, options.baseDelayMs ?? 0);
	const maxDelay = options.maxDelayMs ?? Infinity;

	const backoff = Math.pow(2, value - 1);
	const delay = baseDelay * backoff;
	const jitter = options.jitter ? Math.random() + 0.5 : 1;

	return Math.min(maxDelay, delay * jitter);
}

/**
 * Executes a provided asynchronous function and retries on failure, using exponential backoff.
 * The retry behavior can be customized using various options.
 *
 * @param {Function} fn - The asynchronous function to execute, which may be retried on failure.
 * @param {RetryOptions} [options] - Configuration options for retry logic, including maximum attempts, delays, jitter, and custom retry conditions.
 * @return {Promise<T>} A promise that resolves to the value returned by the provided function or rejects with the last error if retries are exhausted.
 */
export async function retry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
	// Execute fn, retry on failure with exponential backoff
	// Delay = min(baseDelay * 2^attempt, maxDelay), optionally with jitter
	// If shouldRetry returns false, stop retrying
	// If all attempts fail, throw the last error

	const opts = {
		maxAttempts: Infinity,
		baseDelayMs: 100,
		maxDelayMs: 10000,
		jitter: true,
		...options,
	};

	let attempts = 0;

	async function run(): Promise<T> {
		try {
			attempts += 1;
			const result = await fn();

			return result;
		} catch (err) {
			const shouldRetry = opts.shouldRetry?.(err as Error, attempts) ?? true;

			if (shouldRetry && attempts < opts.maxAttempts) {
				const backoff = exponentialBackoff(attempts, opts);
				await delay(backoff);

				return run();
			}

			throw err;
		}
	}

	return run();
}
