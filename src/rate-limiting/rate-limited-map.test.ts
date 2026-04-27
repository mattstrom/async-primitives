import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitedMap } from './rate-limited-map.ts';
import { SlidingWindowLimiter } from './sliding-window.ts';
import { TokenBucket } from './token-bucket.ts';

describe('rateLimitedMap', () => {
	test('returns results in order', async () => {
		const limiter = new TokenBucket({ capacity: 10, refillRate: 100 });
		const results = await rateLimitedMap([1, 2, 3], async (n) => n * 10, limiter);
		assert.deepEqual(results, [10, 20, 30]);
	});

	test('rate limits execution', async () => {
		const limiter = new SlidingWindowLimiter({ maxRequests: 2, windowMs: 100 });
		const timestamps: number[] = [];

		await rateLimitedMap(
			[1, 2, 3, 4],
			async (n) => {
				timestamps.push(Date.now());
				return n;
			},
			limiter,
		);

		assert.equal(timestamps.length, 4);
		// First 2 should be fast, 3rd should wait ~100ms
		const gap = timestamps[2] - timestamps[0];
		assert.ok(gap >= 50, `Third request should be delayed, gap was ${gap}ms`);
	});
});
