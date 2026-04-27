import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { CancellableTask, TaskGroup, withTimeout } from './cancellation.ts';
import { delay } from './utils/delay.ts';

describe('CancellableTask', () => {
	test('completes normally', async () => {
		const task = new CancellableTask(async () => 42);
		const result = await task.start();
		assert.equal(result, 42);
	});

	test('cancel before completion rejects', async () => {
		const task = new CancellableTask(async (signal) => {
			await delay(500, signal);
			return 'done';
		});

		const p = task.start();
		await delay(10);
		task.cancel();

		await assert.rejects(p, /[Cc]ancelled/);
		assert.equal(task.isCancelled(), true);
	});

	test('cancel with custom reason', async () => {
		const task = new CancellableTask(async (signal) => {
			await delay(500, signal);
		});
		const p = task.start();
		task.cancel('user navigated away');
		await assert.rejects(p, /user navigated away/);
	});

	test('cancel after completion is no-op', async () => {
		const task = new CancellableTask(async () => 'fast');
		await task.start();
		task.cancel(); // should not throw
		assert.equal(task.isCancelled(), false);
	});

	test('isRunning tracks state', async () => {
		const task = new CancellableTask(async (signal) => {
			await delay(100, signal);
		});
		assert.equal(task.isRunning(), false);
		const p = task.start();
		assert.equal(task.isRunning(), true);
		task.cancel();
		await p.catch(() => {});
		assert.equal(task.isRunning(), false);
	});
});

describe('TaskGroup', () => {
	test('cancelAll cancels all tasks', async () => {
		const group = new TaskGroup();
		const t1 = group.add(async (signal) => {
			await delay(500, signal);
			return 1;
		});
		const t2 = group.add(async (signal) => {
			await delay(500, signal);
			return 2;
		});

		await delay(10);
		group.cancelAll();
		await group.waitForAll();

		assert.equal(t1.isCancelled(), true);
		assert.equal(t2.isCancelled(), true);
	});

	test('waitForAll waits for cancelled tasks to fully settle', async () => {
		const group = new TaskGroup();
		const settled: string[] = [];

		group.add(async (signal) => {
			try {
				await delay(200, signal);
			} finally {
				settled.push('done');
			}
		});

		await delay(10);
		group.cancelAll();
		assert.equal(settled.length, 0);
		await group.waitForAll();
		assert.equal(settled.length, 1);
	});

	test('race returns first success and cancels rest', async () => {
		const group = new TaskGroup();
		let slowRan = false;

		const result = await group.race([
			async (signal) => {
				await delay(10, signal);
				return 'fast';
			},
			async (signal) => {
				await delay(500, signal);
				slowRan = true;
				return 'slow';
			},
		]);

		assert.equal(result, 'fast');
		await delay(20);
		// The slow task should have been cancelled, so slowRan stays false
		assert.equal(slowRan, false);
	});

	test('waitForAll waits for all tasks', async () => {
		const group = new TaskGroup();
		const results: string[] = [];

		group.add(async () => {
			await delay(10);
			results.push('a');
		});
		group.add(async () => {
			await delay(30);
			results.push('b');
		});

		await group.waitForAll();
		assert.equal(results.length, 2);
	});
});

describe('withTimeout', () => {
	test('returns result if fast enough', async () => {
		const result = await withTimeout(async () => {
			await delay(10);
			return 'done';
		}, 200);
		assert.equal(result, 'done');
	});

	test('rejects on timeout', async () => {
		await assert.rejects(
			() =>
				withTimeout(async (signal) => {
					await delay(500, signal);
					return 'slow';
				}, 50),
			/[Tt]imeout/,
		);
	});

	test('signal is aborted on timeout', async () => {
		let signalAborted = false;
		await withTimeout(async (signal) => {
			signal.addEventListener('abort', () => {
				signalAborted = true;
			});
			await delay(500, signal);
		}, 50).catch(() => {});

		assert.equal(signalAborted, true);
	});
});
