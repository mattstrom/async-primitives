import type { SlidingWindowLimiter } from './sliding-window.ts';
import type { TokenBucket } from './token-bucket.ts';

/**
 * Processes an array of items using the provided asynchronous function, adhering to rate limiting constraints
 * enforced by the given limiter. Each item is processed in input order and a token is acquired from the limiter
 * before invoking the function.
 *
 * @param {T[]} items - An array of items to process.
 * @param {(item: T) => Promise<U>} fn - An asynchronous function to apply to each item in the array.
 * @param {TokenBucket | SlidingWindowLimiter} limiter - A rate-limiting mechanism to throttle the execution of fn.
 * @return {Promise<U[]>} A promise that resolves to an array of results from applying fn to each item, in the same order as the input array.
 */
export async function rateLimitedMap<T, U>(
	items: T[],
	fn: (item: T) => Promise<U>,
	limiter: TokenBucket | SlidingWindowLimiter,
): Promise<U[]> {
	// Process items through fn, acquiring a token before each call
	// Return results in input order

	return Promise.all(
		items.map(async (item) => {
			await limiter.acquire();
			return await fn(item);
		}),
	);
}
