import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { Semaphore } from './semaphore.ts';
import { delay } from '../utils/delay.ts';

describe('Semaphore', () => {
	test('acquire resolves immediately when permits available', async () => {
		const sem = new Semaphore(2);
		assert.equal(sem.available(), 2);
		await sem.acquire();
		assert.equal(sem.available(), 1);
	});

	test('acquire waits when no permits', async () => {
		const sem = new Semaphore(1);
		await sem.acquire();

		let acquired = false;
		const p = sem.acquire().then(() => {
			acquired = true;
		});

		await delay(20);
		assert.equal(acquired, false);

		sem.release();
		await p;
		assert.equal(acquired, true);
	});

	test('release wakes waiters in FIFO order', async () => {
		const sem = new Semaphore(1);
		await sem.acquire();

		const order: number[] = [];
		const p1 = sem.acquire().then(() => order.push(1));
		const p2 = sem.acquire().then(() => order.push(2));

		sem.release();
		await p1;
		sem.release();
		await p2;
		assert.deepEqual(order, [1, 2]);
	});
});
