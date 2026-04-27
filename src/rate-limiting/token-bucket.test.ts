import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { TokenBucket } from './token-bucket.ts';
import { delay } from '../utils/delay.ts';

describe('TokenBucket', () => {
	test('starts at capacity', () => {
		const bucket = new TokenBucket({ capacity: 10, refillRate: 5 });
		assert.equal(bucket.available(), 10);
	});

	test('acquire consumes tokens', async () => {
		const bucket = new TokenBucket({ capacity: 5, refillRate: 1 });
		await bucket.acquire(3);
		assert.equal(bucket.available(), 2);
	});

	test('tryAcquire returns false when insufficient', () => {
		const bucket = new TokenBucket({ capacity: 2, refillRate: 1 });
		assert.equal(bucket.tryAcquire(1), true);
		assert.equal(bucket.tryAcquire(1), true);
		assert.equal(bucket.tryAcquire(1), false);
	});

	test('tokens refill over time', async () => {
		const bucket = new TokenBucket({ capacity: 10, refillRate: 20 }); // 20/sec
		await bucket.acquire(10); // drain
		assert.ok(bucket.available() < 1);

		await delay(250); // should refill ~5 tokens
		const avail = bucket.available();
		assert.ok(avail >= 3 && avail <= 7, `Expected ~5 tokens, got ${avail}`);
	});

	test('acquire waits when empty', async () => {
		const bucket = new TokenBucket({ capacity: 1, refillRate: 20 });
		await bucket.acquire(1);

		const start = Date.now();
		await bucket.acquire(1); // must wait for refill
		const elapsed = Date.now() - start;
		assert.ok(elapsed >= 20, `Should have waited for refill, waited ${elapsed}ms`);
	});

	test('does not exceed capacity', async () => {
		const bucket = new TokenBucket({ capacity: 5, refillRate: 100 });
		await delay(200); // way more than enough to fill
		assert.equal(bucket.available(), 5);
	});
});
