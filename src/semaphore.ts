import { createDeferred, type Deferred } from './utils/deferred.ts';

/**
 * A Semaphore is a concurrency control mechanism that limits the number of concurrent executions
 * to a specified maximum number of permits. It helps in managing access to limited resources.
 *
 * This implementation provides an asynchronous interface for acquiring and releasing permits,
 * and ensures that waiting callers are served in a first-in-first-out (FIFO) manner.
 */
export class Semaphore implements Disposable {
	private claims: number = 0;
	private queue: Deferred<void>[] = [];

	constructor(private readonly permits: number) {}

	[Symbol.dispose]() {
		this.queue = [];
	}

	async acquire(): Promise<void> {
		// Wait until a permit is available, then take it
		// If permits > 0, resolve immediately
		// Otherwise, queue the caller (FIFO)

		if (this.available() > 0) {
			this.claims += 1;
			return;
		}

		const deferred = createDeferred<void>();

		this.queue.unshift(deferred);

		return deferred.promise;
	}

	release(): void {
		this.claims -= 1;

		if (this.queue.length > 0) {
			const next = this.queue.pop()!;
			this.claims += 1;
			next.resolve();
		}
	}

	available(): number {
		return this.permits - this.claims;
	}
}
