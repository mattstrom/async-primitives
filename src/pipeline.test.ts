import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { AsyncQueue } from './async-queue.ts';
import { pipeline } from './pipeline.ts';

describe('pipeline', () => {
	test('transforms items from source to sink', async () => {
		const source = new AsyncQueue<number>();
		const sink = new AsyncQueue<number>();

		source.enqueue(1);
		source.enqueue(2);
		source.enqueue(3);
		source.close();

		await pipeline(source, async (n) => n * 10, sink, 2);

		const results: number[] = [];
		try {
			while (true) results.push(await sink.dequeue());
		} catch {
			/* closed */
		}

		assert.equal(results.length, 3);
		assert.ok(results.includes(10));
		assert.ok(results.includes(20));
		assert.ok(results.includes(30));
	});

	test('closes sink when done', async () => {
		const source = new AsyncQueue<string>();
		const sink = new AsyncQueue<string>();

		source.enqueue('a');
		source.close();

		await pipeline(source, async (s) => s.toUpperCase(), sink, 1);
		assert.equal(sink.closed, true);
	});
});
