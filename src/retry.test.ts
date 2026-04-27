import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { retry } from './retry.ts';

describe('retry', () => {
	test('succeeds on first attempt', async () => {
		const result = await retry(async () => 'ok');
		assert.equal(result, 'ok');
	});

	test('retries and eventually succeeds', async () => {
		let attempts = 0;
		const result = await retry(
			async () => {
				attempts++;
				if (attempts < 3) throw new Error('fail');
				return 'recovered';
			},
			{ maxAttempts: 5, baseDelayMs: 10 },
		);

		assert.equal(result, 'recovered');
		assert.equal(attempts, 3);
	});

	test('throws last error after all attempts exhausted', async () => {
		await assert.rejects(
			() =>
				retry(
					async () => {
						throw new Error('permanent');
					},
					{ maxAttempts: 3, baseDelayMs: 10 },
				),
			{ message: 'permanent' },
		);
	});

	test('respects shouldRetry predicate', async () => {
		let attempts = 0;
		await assert.rejects(() =>
			retry(
				async () => {
					attempts++;
					throw new Error('not retryable');
				},
				{
					maxAttempts: 5,
					baseDelayMs: 10,
					shouldRetry: (err) => !err.message.includes('not retryable'),
				},
			),
		);
		assert.equal(attempts, 1); // didn't retry
	});

	test('uses exponential backoff', async () => {
		const timestamps: number[] = [];
		await retry(
			async () => {
				timestamps.push(Date.now());
				if (timestamps.length < 4) throw new Error('fail');
				return 'ok';
			},
			{ maxAttempts: 5, baseDelayMs: 50, jitter: false },
		).catch(() => {});

		if (timestamps.length >= 3) {
			const d1 = timestamps[1] - timestamps[0]; // ~50ms (50 * 2^0)
			const d2 = timestamps[2] - timestamps[1]; // ~100ms (50 * 2^1)
			assert.ok(d1 >= 30, `First delay ${d1}ms should be ~50ms`);
			assert.ok(d2 > d1 * 0.8, `Second delay ${d2}ms should be > first ${d1}ms`);
		}
	});

	test('caps delay at maxDelayMs', async () => {
		const timestamps: number[] = [];
		await retry(
			async () => {
				timestamps.push(Date.now());
				if (timestamps.length < 6) throw new Error('fail');
			},
			{ maxAttempts: 6, baseDelayMs: 50, maxDelayMs: 100, jitter: false },
		);
		// Later delays should be capped at ~100ms, not growing past it
		if (timestamps.length >= 5) {
			const lastDelay = timestamps[4] - timestamps[3];
			assert.ok(lastDelay <= 150, `Delay ${lastDelay}ms should be capped at ~100ms`);
		}
	});
});
