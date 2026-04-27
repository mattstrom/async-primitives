import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { AsyncQueue } from './async-queue.ts';
import { delay } from './utils/delay.ts';

describe('AsyncQueue', () => {
	test('enqueue then dequeue returns item', async () => {
		const q = new AsyncQueue<number>();
		q.enqueue(1);
		q.enqueue(2);
		assert.equal(await q.dequeue(), 1);
		assert.equal(await q.dequeue(), 2);
	});

	test('dequeue waits for enqueue', async () => {
		const q = new AsyncQueue<string>();
		let result: string | undefined;
		const p = q.dequeue().then((v) => {
			result = v;
		});

		await delay(20);
		assert.equal(result, undefined);

		q.enqueue('hello');
		await p;
		assert.equal(result, 'hello');
	});

	test('multiple waiters served FIFO', async () => {
		const q = new AsyncQueue<number>();
		const order: number[] = [];
		const p1 = q.dequeue().then((v) => {
			order.push(v);
		});
		const p2 = q.dequeue().then((v) => {
			order.push(v);
		});

		q.enqueue(10);
		q.enqueue(20);
		await Promise.all([p1, p2]);
		assert.deepEqual(order, [10, 20]);
	});

	test('size tracks items', () => {
		const q = new AsyncQueue<number>();
		assert.equal(q.size, 0);
		q.enqueue(1);
		q.enqueue(2);
		assert.equal(q.size, 2);
	});

	test('close rejects waiting consumers', async () => {
		const q = new AsyncQueue<number>();
		const p = q.dequeue();
		q.close();
		await assert.rejects(p, /[Qq]ueue closed/);
	});

	test('close allows draining remaining items', async () => {
		const q = new AsyncQueue<number>();
		q.enqueue(1);
		q.enqueue(2);
		q.close();
		assert.equal(await q.dequeue(), 1);
		assert.equal(await q.dequeue(), 2);
		await assert.rejects(q.dequeue(), /[Qq]ueue closed/);
	});

	test('enqueue after close throws', () => {
		const q = new AsyncQueue<number>();
		q.close();
		assert.throws(() => q.enqueue(1), /[Qq]ueue closed/);
	});
});
