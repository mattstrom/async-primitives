import { test, describe } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './circuit-breaker.ts';
import { delay } from './utils/index.ts';

describe('CircuitBreaker', () => {
	test('closed state passes through', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
		const result = await cb.execute(async () => 'ok');
		assert.equal(result, 'ok');
		assert.equal(cb.getState(), 'closed');
	});

	test('opens after failure threshold', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });
		for (let i = 0; i < 2; i++) {
			await cb
				.execute(async () => {
					throw new Error('fail');
				})
				.catch(() => {});
		}
		assert.equal(cb.getState(), 'open');
		assert.equal(cb.getStats().failures, 2);
	});

	test('open state rejects immediately', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 500 });
		await cb
			.execute(async () => {
				throw new Error('fail');
			})
			.catch(() => {});
		assert.equal(cb.getState(), 'open');

		await assert.rejects(() => cb.execute(async () => 'should not run'), /[Cc]ircuit open/);
	});

	test('transitions to half-open after timeout', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
		await cb
			.execute(async () => {
				throw new Error('fail');
			})
			.catch(() => {});
		assert.equal(cb.getState(), 'open');

		await delay(60);
		assert.equal(cb.getState(), 'half-open');
	});

	test('half-open success closes circuit', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
		await cb
			.execute(async () => {
				throw new Error('fail');
			})
			.catch(() => {});

		await delay(60);
		const result = await cb.execute(async () => 'recovered');
		assert.equal(result, 'recovered');
		assert.equal(cb.getState(), 'closed');
	});

	test('half-open failure reopens circuit', async () => {
		const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
		await cb
			.execute(async () => {
				throw new Error('fail');
			})
			.catch(() => {});

		await delay(60);
		await cb
			.execute(async () => {
				throw new Error('still broken');
			})
			.catch(() => {});
		assert.equal(cb.getState(), 'open');
	});
});
