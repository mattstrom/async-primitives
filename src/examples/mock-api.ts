import type { MessageResponse, MessagesAPI } from './prompt-runner.ts';

// ==================== Error classes ====================

export class RateLimitError extends Error {
	status = 429;
	constructor(message = 'Too Many Requests') {
		super(message);
		this.name = 'RateLimitError';
	}
}

export class ServerError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = 'ServerError';
	}
}

export class BadRequestError extends Error {
	status = 400;
	constructor(message = 'Bad Request') {
		super(message);
		this.name = 'BadRequestError';
	}
}

export class UnauthorizedError extends Error {
	status = 401;
	constructor(message = 'Unauthorized') {
		super(message);
		this.name = 'UnauthorizedError';
	}
}

export class NetworkError extends Error {
	constructor(message = 'Network failure') {
		super(message);
		this.name = 'NetworkError';
	}
}

// ==================== Mock API ====================

export type MockOutcome = { type: 'success'; content?: string } | { type: 'error'; error: Error };

export interface MockOptions {
	/** Per-call latency in ms. Number for fixed, function for variable per prompt. */
	latencyMs?: number | ((prompt: string) => number);
	/** Per-call behavior; return undefined to fall through to default success. */
	behavior?: (prompt: string, callIndex: number) => MockOutcome | undefined;
}

/** A controllable in-memory implementation of `MessagesAPI` for tests. */
export class MockMessagesAPI implements MessagesAPI {
	/** Wall-clock timestamp (Date.now()) of each createMessage call's start. */
	callTimes: number[] = [];
	/** Total number of createMessage invocations (success or failure). */
	callCount = 0;
	/** Currently-running calls. Useful for measuring concurrency. */
	concurrentCount = 0;
	/** Highest concurrentCount observed during the test. */
	maxConcurrent = 0;
	/** Number of in-flight calls aborted via signal. */
	abortedCount = 0;

	constructor(private readonly opts: MockOptions = {}) {}

	async createMessage(prompt: string, options?: { signal?: AbortSignal }): Promise<MessageResponse> {
		const callIndex = this.callCount++;
		this.callTimes.push(Date.now());
		this.concurrentCount++;
		this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrentCount);

		try {
			const latency =
				typeof this.opts.latencyMs === 'function' ? this.opts.latencyMs(prompt) : (this.opts.latencyMs ?? 10);

			await abortableDelay(latency, options?.signal, () => {
				this.abortedCount++;
			});

			const outcome = this.opts.behavior?.(prompt, callIndex);
			if (outcome?.type === 'error') {
				throw outcome.error;
			}

			return {
				content: outcome?.content ?? `response-to:${prompt}`,
				usage: { input_tokens: 10, output_tokens: 20 },
			};
		} finally {
			this.concurrentCount--;
		}
	}
}

function abortableDelay(ms: number, signal: AbortSignal | undefined, onAbort: () => void): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			onAbort();
			return reject(new Error('Aborted'));
		}

		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', handler);
			resolve();
		}, ms);

		const handler = () => {
			clearTimeout(timer);
			onAbort();
			reject(new Error('Aborted'));
		};

		signal?.addEventListener('abort', handler, { once: true });
	});
}
