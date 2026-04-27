// ==================== Types ====================

import { AsyncQueue } from '../async-queue.ts';
import { SlidingWindowLimiter } from '../rate-limiting/index.ts';
import { retry } from '../retry.ts';

export interface Prompt {
	id: string;
	content: string;
}

export interface MessageResponse {
	content: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

/**
 * The (mockable) Messages API surface this exercise uses.
 * In production this would be the Anthropic SDK; for the interview it's a mock.
 */
export interface MessagesAPI {
	createMessage(prompt: string, options?: { signal?: AbortSignal }): Promise<MessageResponse>;
}

export type RunResult =
	| {
			prompt: Prompt;
			status: 'success';
			response: MessageResponse;
			attempts: number;
	  }
	| {
			prompt: Prompt;
			status: 'error';
			error: Error;
			attempts: number;
	  };

export interface PromptRunnerOptions {
	api: MessagesAPI;
	concurrency: number;
	rateLimit?: {
		maxRequests: number;
		windowMs: number;
	};
	maxRetries?: number;
	signal?: AbortSignal;
}

// ==================== PromptRunner ====================

/**
 * Drives a list of prompts through the Messages API with bounded concurrency,
 * optional rate limiting, retry-on-transient-error, and whole-run cancellation.
 *
 * Yields each `RunResult` as soon as that prompt finishes — NOT in input order.
 *
 * See README.md for full behavioral requirements.
 */
export class PromptRunner implements Disposable {
	private sink: AsyncQueue<RunResult>;
	private rateLimiter: SlidingWindowLimiter | null = null;

	constructor(private readonly options: PromptRunnerOptions) {
		// store options, set up internal state
		this.options.maxRetries ??= 3;
		this.options.signal ??= AbortSignal.any([]);

		if (options.rateLimit) {
			this.rateLimiter = new SlidingWindowLimiter({
				maxRequests: options.rateLimit?.maxRequests,
				windowMs: options.rateLimit?.windowMs,
				signal: this.options.signal,
			});
		}

		this.sink = new AsyncQueue(this.options.concurrency);
	}

	[Symbol.dispose]() {
		this.rateLimiter?.[Symbol.dispose]();
	}

	/**
	 * Stream completed results back as they finish.
	 *
	 * Requirements (see README for detail):
	 *  - At most `concurrency` requests in flight at any moment.
	 *  - If `rateLimit` is set, no more than `maxRequests` starts per `windowMs`.
	 *  - Transient errors (429, 5xx, NetworkError) retry up to `maxRetries` with backoff.
	 *  - Permanent errors yield as `{ status: 'error' }`; the run continues.
	 *  - If `signal` aborts: forward to in-flight calls, stop new starts, end iteration cleanly.
	 *  - Backpressure: don't buffer unbounded results when the consumer is slow.
	 */
	run(prompts: Prompt[]): AsyncIterable<RunResult> {
		const source = new AsyncQueue<Prompt>();

		(async () => {
			for (const prompt of prompts) {
				await source.enqueue(prompt);
			}

			source.close();
		})().catch((err) => {
			console.error(err);
		});

		this.startPipeline(source).catch(() => {});

		return this.sink;
	}

	private async startPipeline(source: AsyncQueue<Prompt>): Promise<void> {
		const { concurrency } = this.options;

		const processors: Promise<void>[] = [];

		for (let i = 0; i < concurrency; i += 1) {
			processors.push(this.makeConsumer(source));
		}

		try {
			await Promise.all(processors);
		} finally {
			this.sink.close();
		}
	}

	private async makeConsumer(source: AsyncQueue<Prompt>) {
		for await (const prompt of source) {
			const result = await this.worker(prompt);
			await this.sink.enqueue(result);
		}
	}

	private async worker(prompt: Prompt): Promise<RunResult> {
		const { api, maxRetries } = this.options;

		this.options.signal?.throwIfAborted();

		try {
			const result = await retry(
				async () => {
					if (this.rateLimiter) {
						await this.rateLimiter.acquire();
					}

					return await api.createMessage(prompt.content, { signal: this.options.signal });
				},
				{
					maxAttempts: maxRetries,
					shouldRetry: (error: Error) => isTransientError(error),
				},
			);

			return {
				prompt,
				status: 'success',
				response: result,
				attempts: 1,
			};
		} catch (err) {
			return {
				prompt,
				status: 'error',
				error: err as Error,
				attempts: 1,
			};
		}
	}
}

function isTransientError(err: unknown): boolean {
	if (err instanceof Error) {
		if (err.name === 'NetworkError') {
			return true;
		}

		const status = (err as any).status;

		if (status === 429 || (status >= 500 && status < 600)) {
			return true;
		}
	}

	return false;
}
