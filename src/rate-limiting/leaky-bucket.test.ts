import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { LeakyBucket } from './leaky-bucket.ts';
import { delay } from '../utils/delay.ts';

describe('LeakyBucket', () => {
	test('starts empty', () => {
		const bucket = new LeakyBucket({ capacity: 5, drainRate: 1 });
		assert.equal(bucket.pending(), 0);
		assert.equal(bucket.isFull(), false);
	});

	test('isFull reflects queue depth', async () => {
		const bucket = new LeakyBucket({ capacity: 2, drainRate: 0.1 }); // very slow drain
		bucket.acquire().catch(() => {});
		bucket.acquire().catch(() => {});
		assert.equal(bucket.isFull(), true);
	});

	test('acquire throws when full', async () => {
		const bucket = new LeakyBucket({ capacity: 1, drainRate: 0.1 });
		bucket.acquire().catch(() => {}); // fill the queue
		await assert.rejects(() => bucket.acquire(), /overflow/);
	});

	test('acquire resolves at drain rate', async () => {
		const bucket = new LeakyBucket({ capacity: 5, drainRate: 20 }); // 20/sec = 50ms per request

		const start = Date.now();
		await bucket.acquire();
		const elapsed = Date.now() - start;

		assert.ok(elapsed >= 20 && elapsed < 200, `Expected ~50ms, got ${elapsed}ms`);
	});

	test('requests drain in order at constant rate', async () => {
		const bucket = new LeakyBucket({ capacity: 5, drainRate: 20 }); // 50ms per drain
		const results: number[] = [];

		const p1 = bucket.acquire().then(() => results.push(1));
		const p2 = bucket.acquire().then(() => results.push(2));
		const p3 = bucket.acquire().then(() => results.push(3));

		await Promise.all([p1, p2, p3]);
		assert.deepEqual(results, [1, 2, 3]);
	});

	test('pending decreases as requests drain', async () => {
		const bucket = new LeakyBucket({ capacity: 5, drainRate: 50 }); // 50/sec = 20ms per request
		bucket.acquire().catch(() => {});
		bucket.acquire().catch(() => {});
		bucket.acquire().catch(() => {});
		assert.equal(bucket.pending(), 3);

		await delay(50); // ~2-3 drain cycles
		assert.ok(bucket.pending() < 3);
	});
});
