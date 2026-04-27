import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { delay } from '../utils/index.ts';
import { SlidingWindowLimiter } from './sliding-window.ts';

describe('SlidingWindowLimiter', () => {
	test('allows requests within limit', async () => {
		const limiter = new SlidingWindowLimiter({ maxRequests: 3, windowMs: 1000 });
		assert.equal(limiter.tryAcquire(), true);
		assert.equal(limiter.tryAcquire(), true);
		assert.equal(limiter.tryAcquire(), true);
		assert.equal(limiter.tryAcquire(), false); // 4th blocked
	});

	test('allows requests after window expires', async () => {
		const limiter = new SlidingWindowLimiter({ maxRequests: 2, windowMs: 50 });
		assert.equal(limiter.tryAcquire(), true);
		assert.equal(limiter.tryAcquire(), true);
		assert.equal(limiter.tryAcquire(), false);

		await delay(60);
		assert.equal(limiter.tryAcquire(), true); // window expired
	});

	test('acquire waits until window has room', async () => {
		const limiter = new SlidingWindowLimiter({ maxRequests: 1, windowMs: 50 });
		await limiter.acquire();

		const start = Date.now();
		await limiter.acquire();
		const elapsed = Date.now() - start;
		assert.ok(elapsed >= 30, `Should have waited ~50ms, waited ${elapsed}ms`);
	});
});
