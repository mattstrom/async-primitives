import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { PromptRunner, type Prompt, type RunResult } from './prompt-runner.ts';
import { MockMessagesAPI, RateLimitError, ServerError, BadRequestError } from './mock-api.ts';

function makePrompts(n: number): Prompt[] {
	return Array.from({ length: n }, (_, i) => ({
		id: `p${i}`,
		content: `prompt-${i}`,
	}));
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const r of iter) out.push(r);
	return out;
}

describe('PromptRunner — basics', () => {
	test('returns one result per prompt', async () => {
		const api = new MockMessagesAPI({ latencyMs: 5 });
		const runner = new PromptRunner({ api, concurrency: 2 });
		const results = await collect(runner.run(makePrompts(5)));

		assert.equal(results.length, 5);
		assert.ok(results.every((r) => r.status === 'success'));
	});

	test('empty prompt list yields no results', async () => {
		const api = new MockMessagesAPI();
		const runner = new PromptRunner({ api, concurrency: 4 });
		const results = await collect(runner.run([]));
		assert.deepEqual(results, []);
	});

	test('every prompt is associated with its own result', async () => {
		const api = new MockMessagesAPI({ latencyMs: 5 });
		const runner = new PromptRunner({ api, concurrency: 3 });
		const prompts = makePrompts(10);
		const results = await collect(runner.run(prompts));

		const resultIds = results.map((r) => r.prompt.id).sort();
		const promptIds = prompts.map((p) => p.id).sort();
		assert.deepEqual(resultIds, promptIds);
	});

	test('result includes the original prompt object', async () => {
		const api = new MockMessagesAPI({ latencyMs: 5 });
		const runner = new PromptRunner({ api, concurrency: 1 });
		const prompts = makePrompts(2);
		const results = await collect(runner.run(prompts));

		for (const r of results) {
			const matching = prompts.find((p) => p.id === r.prompt.id);
			assert.equal(r.prompt.content, matching?.content);
		}
	});
});

describe('PromptRunner — concurrency', () => {
	test('respects concurrency limit', async () => {
		const api = new MockMessagesAPI({ latencyMs: 30 });
		const runner = new PromptRunner({ api, concurrency: 3 });
		await collect(runner.run(makePrompts(10)));
		assert.ok(api.maxConcurrent <= 3, `maxConcurrent was ${api.maxConcurrent}, expected <=3`);
	});

	test('actually parallelizes (faster than serial)', async () => {
		const api = new MockMessagesAPI({ latencyMs: 30 });
		const runner = new PromptRunner({ api, concurrency: 5 });
		const start = Date.now();
		await collect(runner.run(makePrompts(5)));
		const elapsed = Date.now() - start;
		// 5 × 30ms = 150ms serial; should be ~30–50ms parallel.
		assert.ok(elapsed < 100, `expected <100ms, got ${elapsed}ms`);
	});

	test('concurrency 1 runs serially', async () => {
		const api = new MockMessagesAPI({ latencyMs: 10 });
		const runner = new PromptRunner({ api, concurrency: 1 });
		await collect(runner.run(makePrompts(4)));
		assert.equal(api.maxConcurrent, 1);
	});
});

describe('PromptRunner — streaming order', () => {
	test('yields results as they complete, not in input order', async () => {
		// Make later prompts faster than earlier ones so completion order != input order.
		const api = new MockMessagesAPI({
			latencyMs: (prompt) => {
				const idx = Number(prompt.match(/(\d+)/)![1]);
				return (5 - idx) * 20; // p0 slowest, p4 fastest
			},
		});
		const runner = new PromptRunner({ api, concurrency: 5 });
		const results = await collect(runner.run(makePrompts(5)));

		// First completed should not be p0.
		assert.notEqual(results[0].prompt.id, 'p0');
		// Last completed should be p0.
		assert.equal(results[results.length - 1].prompt.id, 'p0');
	});

	test('yields incrementally, not all at the end', async () => {
		const api = new MockMessagesAPI({ latencyMs: 30 });
		const runner = new PromptRunner({ api, concurrency: 3 });

		const start = Date.now();
		const firstResultTimes: number[] = [];

		for await (const _ of runner.run(makePrompts(6))) {
			firstResultTimes.push(Date.now() - start);
		}

		// First result should arrive well before the last.
		assert.ok(
			firstResultTimes[0] < firstResultTimes[firstResultTimes.length - 1] - 10,
			`first arrived at ${firstResultTimes[0]}ms, last at ${firstResultTimes.at(-1)}ms`,
		);
	});
});

describe('PromptRunner — error handling', () => {
	test('permanent errors yield error results without retry', async () => {
		let badRequestCalls = 0;
		const api = new MockMessagesAPI({
			latencyMs: 5,
			behavior: (prompt) => {
				if (prompt === 'prompt-1') {
					badRequestCalls++;
					return { type: 'error', error: new BadRequestError('bad input') };
				}
				return undefined;
			},
		});
		const runner = new PromptRunner({ api, concurrency: 2, maxRetries: 3 });
		const results = await collect(runner.run(makePrompts(3)));

		const errored = results.find((r) => r.prompt.id === 'p1');
		assert.equal(errored?.status, 'error');
		assert.equal(badRequestCalls, 1, 'permanent error should not be retried');
		assert.equal(results.filter((r) => r.status === 'success').length, 2);
	});

	test('transient errors are retried and eventually succeed', async () => {
		const attempts = new Map<string, number>();
		const api = new MockMessagesAPI({
			latencyMs: 5,
			behavior: (prompt) => {
				const n = (attempts.get(prompt) ?? 0) + 1;
				attempts.set(prompt, n);
				if (n < 3) {
					return { type: 'error', error: new RateLimitError() };
				}
				return undefined;
			},
		});
		const runner = new PromptRunner({ api, concurrency: 2, maxRetries: 5 });
		const results = await collect(runner.run(makePrompts(2)));

		assert.ok(results.every((r) => r.status === 'success'));
		assert.equal(attempts.get('prompt-0'), 3);
		assert.equal(attempts.get('prompt-1'), 3);
	});

	test('transient errors past maxRetries yield an error result', async () => {
		const api = new MockMessagesAPI({
			latencyMs: 5,
			behavior: () => ({
				type: 'error',
				error: new ServerError(503, 'service unavailable'),
			}),
		});
		const runner = new PromptRunner({ api, concurrency: 1, maxRetries: 2 });
		const results = await collect(runner.run(makePrompts(1)));

		assert.equal(results.length, 1);
		assert.equal(results[0].status, 'error');
	});

	test('one failing prompt does not stop the others', async () => {
		const api = new MockMessagesAPI({
			latencyMs: 5,
			behavior: (prompt) => {
				if (prompt === 'prompt-2') {
					return { type: 'error', error: new BadRequestError() };
				}
				return undefined;
			},
		});
		const runner = new PromptRunner({ api, concurrency: 2 });
		const results = await collect(runner.run(makePrompts(5)));

		assert.equal(results.length, 5);
		assert.equal(results.filter((r) => r.status === 'error').length, 1);
		assert.equal(results.filter((r) => r.status === 'success').length, 4);
	});
});

describe('PromptRunner — rate limiting', () => {
	test('does not exceed maxRequests per window', async () => {
		const api = new MockMessagesAPI({ latencyMs: 5 });
		const runner = new PromptRunner({
			api,
			concurrency: 10, // higher than rate so the limiter is the binding constraint
			rateLimit: { maxRequests: 3, windowMs: 100 },
		});
		await collect(runner.run(makePrompts(6)));

		assert.equal(api.callTimes.length, 6);
		// The 4th call must be at least ~windowMs after the 1st.
		const gap = api.callTimes[3] - api.callTimes[0];
		assert.ok(gap >= 90, `expected >=90ms gap between call 1 and 4, got ${gap}ms`);
	});
});

describe('PromptRunner — cancellation', () => {
	test('aborting the signal stops new starts and ends iteration', async () => {
		const api = new MockMessagesAPI({ latencyMs: 30 });
		const controller = new AbortController();
		using runner = new PromptRunner({
			api,
			concurrency: 2,
			signal: controller.signal,
		});

		const collected: RunResult[] = [];
		const consume = (async () => {
			try {
				for await (const r of runner.run(makePrompts(20))) {
					collected.push(r);
				}
			} catch {
				// abort may surface as either a clean end or a thrown error — both acceptable
			}
		})();

		setTimeout(() => controller.abort(), 50);
		await consume;

		assert.ok(collected.length < 20, `got ${collected.length} results, expected fewer than 20`);
		assert.ok(api.callCount < 20, `started ${api.callCount} requests, expected fewer than 20`);
	});

	test('forwards abort signal to in-flight API calls', async () => {
		const api = new MockMessagesAPI({ latencyMs: 200 });
		const controller = new AbortController();
		const runner = new PromptRunner({
			api,
			concurrency: 3,
			signal: controller.signal,
		});

		const consume = (async () => {
			try {
				for await (const _ of runner.run(makePrompts(3))) {
					// drain
				}
			} catch {
				// accepted
			}
		})();

		setTimeout(() => controller.abort(), 30);
		await consume;

		assert.ok(api.abortedCount >= 1, `expected >=1 in-flight call to be aborted, got ${api.abortedCount}`);
	});
});
