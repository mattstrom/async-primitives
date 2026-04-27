import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { Mutex } from './mutex.ts';
import { delay } from './utils/index.ts';

describe('Mutex', () => {
	test('acquire returns unlock function when unlocked', async () => {
		const mutex = new Mutex();
		assert.equal(mutex.isLocked(), false);
		const unlock = await mutex.acquire();
		assert.equal(mutex.isLocked(), true);
		assert.equal(typeof unlock, 'function');
		unlock();
		assert.equal(mutex.isLocked(), false);
	});

	test('acquire waits when locked', async () => {
		const mutex = new Mutex();
		const unlock1 = await mutex.acquire();

		let secondAcquired = false;
		const p = mutex.acquire().then((unlock) => {
			secondAcquired = true;
			return unlock;
		});

		await delay(20);
		assert.equal(secondAcquired, false);

		unlock1();
		const unlock2 = await p;
		assert.equal(secondAcquired, true);
		unlock2();
	});

	test('waiters are served FIFO', async () => {
		const mutex = new Mutex();
		const unlock1 = await mutex.acquire();
		const order: number[] = [];

		const p1 = mutex.acquire().then((u) => {
			order.push(1);
			u();
		});
		const p2 = mutex.acquire().then((u) => {
			order.push(2);
			u();
		});
		const p3 = mutex.acquire().then((u) => {
			order.push(3);
			u();
		});

		unlock1();
		await Promise.all([p1, p2, p3]);
		assert.deepEqual(order, [1, 2, 3]);
	});

	test('withLock acquires and releases', async () => {
		const mutex = new Mutex();
		const result = await mutex.withLock(async () => {
			assert.equal(mutex.isLocked(), true);
			return 42;
		});
		assert.equal(result, 42);
		assert.equal(mutex.isLocked(), false);
	});

	test('withLock releases on error', async () => {
		const mutex = new Mutex();
		await assert.rejects(
			() =>
				mutex.withLock(async () => {
					throw new Error('boom');
				}),
			{ message: 'boom' },
		);
		assert.equal(mutex.isLocked(), false);
	});

	test('withLock serializes concurrent calls', async () => {
		const mutex = new Mutex();
		let counter = 0;

		await Promise.all(
			Array.from({ length: 5 }, () =>
				mutex.withLock(async () => {
					const val = counter;
					await delay(10);
					counter = val + 1;
				}),
			),
		);

		assert.equal(counter, 5);
	});

	describe('Deadlock Detection', () => {
		test('should detect deadlock and reject pending acquisitions', async () => {
			const timeout = 10;
			const order: number[] = [];

			try {
				const mutex = new Mutex(timeout);
				const unlock1 = await mutex.acquire();

				const p1 = mutex
					.acquire()
					.then((u) => {
						order.push(1);

						// Intentionally not unlocking
						// u();
					})
					.catch(() => {
						order.push(-1);
					});

				const p2 = mutex
					.acquire()
					.then((u) => {
						order.push(2);
						u();
					})
					.catch((err) => {
						order.push(-2);
						throw err;
					});

				unlock1();

				await Promise.all([p1, p2]);
				assert.fail('Did not deadlock');
			} catch (err) {
				assert.deepEqual(order, [1, -2]);
			}
		});
	});
});
