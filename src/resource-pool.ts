import { clearInterval } from 'node:timers';
import { createDeferred, type Deferred } from './utils/deferred.ts';

export interface PoolOptions<T> {
	factory: () => Promise<T>;
	destroy?: (resource: T) => Promise<void>;
	maxSize: number;
	idleTimeoutMs?: number;
	minSize?: number;
}

export interface PoolStats {
	size: number; // total resources (available + in use)
	available: number; // idle resources ready to lend
	pending: number; // callers waiting for a resource
}

/**
 * Represents a generic resource pool for managing reusable resources.
 *
 * @template T The type of resource this pool manages. Must extend `WeakKey`.
 */
export class Pool<T extends WeakKey> {
	private options: Required<PoolOptions<T>>;

	private resources = new Set<T>();
	private inUse = new Set<T>();
	private inFlight = 0;
	private queue: Deferred<T>[] = [];

	private stack = new AsyncDisposableStack();

	private lastUsed = new WeakMap<T, number>();
	private timer: NodeJS.Timeout | null = null;

	get available(): number {
		return this.stats().available;
	}

	get availableResources(): Set<T> {
		return this.resources.difference(this.inUse);
	}

	constructor(options: PoolOptions<T>) {
		// Store options, initialize tracking structures
		this.options = {
			destroy: async () => {},
			idleTimeoutMs: Infinity,
			minSize: 0,
			...options,
		};

		// this.timer = setInterval(() => {
		// 	this.gc();
		// }, 10_000);
	}

	async acquire(): Promise<T> {
		// Return an available resource, or create one, or wait
		// Lazy creation up to maxSize
		// FIFO waiting when at capacity

		if (this.available > 0) {
			return this.getAvailableResource();
		} else if (this.resources.size + this.inFlight < this.options.maxSize) {
			return this.createResource();
		}

		const awaiter = createDeferred<T>();
		this.queue.push(awaiter);

		return await awaiter.promise;
	}

	private getAvailableResource(): T {
		const res = this.availableResources.values().next();

		if (res.done) {
			throw new Error('No available resource');
		}

		const value = res.value;

		this.inUse.add(value);
		this.lastUsed.set(value, Date.now());

		return value;
	}

	// private gc() {
	// 	const { idleTimeoutMs, minSize, destroy } = this.options;
	// 	const now = Date.now();
	// 	const idle = this.resources.values()
	// 		.filter((res) => {
	// 			const lastUsed = this.lastUsed.get(res);
	//
	// 			if (lastUsed === undefined) {
	// 				return true;
	// 			}
	//
	// 			return !this.inUse.has(res) && lastUsed + idleTimeoutMs > now;
	// 		});
	//
	// 	for (const resource of idle) {
	// 		if (this.resources.size <= minSize) {
	// 			break;
	// 		}
	//
	// 		destroy(resource);
	// 		this.resources.delete(resource);
	// 	}
	// }

	release(resource: T): void {
		// Return resource to available set, wake next waiter

		this.inUse.delete(resource);

		if (this.queue.length > 0) {
			const awaiter = this.queue.shift()!;
			this.inUse.add(resource);
			this.lastUsed.set(resource, Date.now());
			awaiter.resolve(resource);
		}
	}

	async withResource<U>(fn: (resource: T) => Promise<U>): Promise<U> {
		// Acquire, run fn, release — even on error
		const resource = await this.acquire();

		try {
			return await fn(resource);
		} finally {
			this.release(resource);
		}
	}

	async destroy(): Promise<void> {
		// Destroy all resources, reject pending acquires

		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}

		for (const pending of this.queue) {
			pending.reject('Pool destroyed');
		}

		this.queue = [];

		await this.stack.disposeAsync();

		this.resources.clear();
		this.inUse.clear();
	}

	async [Symbol.asyncDispose]() {
		return this.destroy();
	}

	stats(): PoolStats {
		return {
			size: this.resources.size,
			available: this.availableResources.size,
			pending: this.queue.length,
		};
	}

	private async createResource(): Promise<T> {
		this.inFlight++;
		const resource = await this.options.factory();
		this.inFlight--;

		this.resources.add(resource);
		this.inUse.add(resource);
		this.lastUsed.set(resource, Date.now());

		this.stack.adopt(resource, (value) => {
			this.options.destroy(value);
		});

		return resource;
	}
}
