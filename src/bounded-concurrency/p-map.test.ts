import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { pMap, pMapSemaphore } from './p-map.ts';
import { delay } from '../utils/delay.ts';

describe('pMap', () => {
	test('processes all items and returns results in order', async () => {
		const results = await pMap(
			[3, 1, 2],
			async (n) => {
				await delay(n * 10);
				return n * 10;
			},
			3,
		);
		assert.deepEqual(results, [30, 10, 20]);
	});

	test('respects concurrency limit', async () => {
		let current = 0;
		let max = 0;
		await pMap(
			[1, 2, 3, 4, 5, 6],
			async () => {
				current++;
				max = Math.max(max, current);
				await delay(30);
				current--;
			},
			2,
		);
		assert.equal(max, 2);
	});

	test('handles empty array', async () => {
		const results = await pMap([], async (x) => x, 3);
		assert.deepEqual(results, []);
	});

	test('rejects on error', async () => {
		await assert.rejects(
			() =>
				pMap(
					[1, 2, 3],
					async (n) => {
						if (n === 2) throw new Error('bad');
						return n;
					},
					2,
				),
			{ message: 'bad' },
		);
	});

	test('passes index to fn', async () => {
		const results = await pMap(['a', 'b', 'c'], async (_, i) => i, 2);
		assert.deepEqual(results, [0, 1, 2]);
	});

	test('concurrency 1 runs serially', async () => {
		const order: number[] = [];
		await pMap(
			[1, 2, 3],
			async (n) => {
				order.push(n);
				await delay(10);
			},
			1,
		);
		assert.deepEqual(order, [1, 2, 3]);
	});
});

describe('pMapSemaphore', () => {
	test('produces same results as pMap', async () => {
		const results = await pMapSemaphore(
			[5, 3, 1, 4, 2],
			async (n) => {
				await delay(n * 5);
				return n * 2;
			},
			2,
		);
		assert.deepEqual(results, [10, 6, 2, 8, 4]);
	});

	test('respects concurrency limit', async () => {
		let current = 0;
		let max = 0;
		await pMapSemaphore(
			[1, 2, 3, 4],
			async () => {
				current++;
				max = Math.max(max, current);
				await delay(20);
				current--;
			},
			3,
		);
		assert.ok(max <= 3);
	});
});
