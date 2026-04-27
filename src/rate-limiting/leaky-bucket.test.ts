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

	test('isFull reflects total cost', () => {
		const bucket = new LeakyBucket({ capacity: 4, drainRate: 0.1 });
		bucket.acquire(2).catch(() => {});
		bucket.acquire(2).catch(() => {});
		assert.equal(bucket.isFull(), true);
	});

	test('acquire throws when adding cost would exceed capacity', async () => {
		const bucket = new LeakyBucket({ capacity: 3, drainRate: 0.1 });
		bucket.acquire(2).catch(() => {}); // totalCost = 2
		await assert.rejects(() => bucket.acquire(2), /overflow/); // would be 4 > 3
	});

	test('high-cost request takes proportionally longer to drain', async () => {
		const bucket = new LeakyBucket({ capacity: 10, drainRate: 20 }); // 20 units/sec = 50ms per unit

		const start = Date.now();
		await bucket.acquire(3); // cost=3 takes ~3 drain ticks = ~150ms
		const elapsed = Date.now() - start;

		assert.ok(elapsed >= 100 && elapsed < 350, `Expected ~150ms for cost=3, got ${elapsed}ms`);
	});

	test('requests drain in order at constant rate', async () => {
		const bucket = new LeakyBucket({ capacity: 10, drainRate: 20 });
		const results: number[] = [];

		const p1 = bucket.acquire(1).then(() => results.push(1));
		const p2 = bucket.acquire(1).then(() => results.push(2));
		const p3 = bucket.acquire(1).then(() => results.push(3));

		await Promise.all([p1, p2, p3]);
		assert.deepEqual(results, [1, 2, 3]);
	});

	test('pending reflects total cost units', () => {
		const bucket = new LeakyBucket({ capacity: 10, drainRate: 0.1 });
		bucket.acquire(3).catch(() => {});
		bucket.acquire(2).catch(() => {});
		assert.equal(bucket.pending(), 5);
	});

	test('pending decreases as cost drains', async () => {
		const bucket = new LeakyBucket({ capacity: 10, drainRate: 50 }); // 50 units/sec = 20ms per unit
		bucket.acquire(3).catch(() => {});
		assert.equal(bucket.pending(), 3);

		await delay(50); // ~2-3 drain ticks
		assert.ok(bucket.pending() < 3);
	});

	test('high-cost request blocks lower-cost requests behind it', async () => {
		const bucket = new LeakyBucket({ capacity: 10, drainRate: 20 }); // 50ms per unit

		const start = Date.now();
		const p1 = bucket.acquire(2); // cost=2 takes ~100ms
		const p2 = bucket.acquire(1); // must wait for p1 to fully drain first

		await p1;
		const t1 = Date.now() - start;

		await p2;
		const t2 = Date.now() - start;

		assert.ok(t1 >= 80, `p1 should take ~100ms, took ${t1}ms`);
		assert.ok(t2 >= t1 + 30, `p2 should resolve after p1, t1=${t1}ms t2=${t2}ms`);
	});
});
