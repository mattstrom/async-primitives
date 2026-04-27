import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { Pool } from './resource-pool.ts';
import { delay } from './utils/index.ts';

let nextId = 0;
function mockFactory() {
	return Promise.resolve({ id: ++nextId, alive: true });
}
function mockDestroy(r: { id: number; alive: boolean }) {
	r.alive = false;
	return Promise.resolve();
}

describe('Pool', () => {
	test('acquire creates resource lazily', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 3 });
		const r = await pool.acquire();
		assert.equal(r.id, 1);
		assert.equal(pool.stats().size, 1);
	});

	test('release makes resource available again', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 2 });
		const r1 = await pool.acquire();
		pool.release(r1);
		assert.equal(pool.stats().available, 1);

		const r2 = await pool.acquire();
		assert.equal(r2.id, r1.id); // reused, not new
		assert.equal(pool.stats().size, 1);
	});

	test('acquire waits when at maxSize', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 1 });
		const r1 = await pool.acquire();

		let acquired = false;
		const p = pool.acquire().then((r) => {
			acquired = true;
			return r;
		});

		await delay(20);
		assert.equal(acquired, false);
		assert.equal(pool.stats().pending, 1);

		pool.release(r1);
		const r2 = await p;
		assert.equal(acquired, true);
		assert.equal(r2.id, r1.id);
	});

	test('FIFO order for waiters', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 1 });
		const r = await pool.acquire();

		const order: number[] = [];
		const p1 = pool.acquire().then((r) => {
			order.push(1);
			pool.release(r);
		});
		const p2 = pool.acquire().then((r) => {
			order.push(2);
			pool.release(r);
		});

		pool.release(r);
		await Promise.all([p1, p2]);
		assert.deepEqual(order, [1, 2]);
	});

	test('withResource acquires and releases', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 2 });
		const result = await pool.withResource(async (r) => {
			return `used-${r.id}`;
		});
		assert.equal(result, 'used-1');
		assert.equal(pool.stats().available, 1);
	});

	test('withResource releases on error', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 1 });
		await assert.rejects(
			() =>
				pool.withResource(async () => {
					throw new Error('boom');
				}),
			{ message: 'boom' },
		);
		assert.equal(pool.stats().available, 1); // resource returned
	});

	test('destroy cleans up all resources', async () => {
		nextId = 0;
		const resources: { id: number; alive: boolean }[] = [];
		const pool = new Pool({
			factory: async () => {
				const r = { id: ++nextId, alive: true };
				resources.push(r);
				return r;
			},
			destroy: mockDestroy,
			maxSize: 3,
		});

		await pool.acquire();
		const r2 = await pool.acquire();
		pool.release(r2);
		await pool.destroy();

		assert.ok(resources.every((r) => !r.alive));
	});

	test('concurrent withResource respects maxSize', async () => {
		nextId = 0;
		const pool = new Pool({ factory: mockFactory, maxSize: 2 });
		let maxConcurrent = 0;
		let current = 0;

		await Promise.all(
			Array.from({ length: 5 }, () =>
				pool.withResource(async () => {
					current++;
					maxConcurrent = Math.max(maxConcurrent, current);
					await delay(20);
					current--;
				}),
			),
		);

		assert.ok(maxConcurrent <= 2, `Max concurrent ${maxConcurrent} should be <= 2`);
	});
});
