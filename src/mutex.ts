import { createDeferred, type Deferred } from './utils/deferred.ts';

export type UnlockFn = () => void;

/**
 * A synchronization primitive that provides mutual exclusion (mutex) functionality.
 * Ensures only one asynchronous operation can acquire the lock at a time, allowing for
 * proper coordination of shared resources in concurrent environments. It includes deadlock
 * detection with an optional timeout mechanism.
 */
export class Mutex {
	private locked = false;
	private queue: Deferred<void>[] = [];

	private timeout?: number;
	private timer: NodeJS.Timeout | null = null;
	private deadlocked: boolean = false;

	constructor(timeout?: number) {
		this.timeout = timeout;
	}

	async acquire(): Promise<UnlockFn> {
		// If unlocked, lock and return unlock function
		// If locked, wait (FIFO) until it's your turn

		const deferred = createDeferred<void>();

		if (this.deadlocked) {
			throw new Error('Deadlock timeout');
		}

		if (this.isLocked()) {
			this.queue.unshift(deferred);
			await deferred.promise;
		}

		this.locked = true;
		this.detectDeadlock();

		return () => {
			this.unlock();
		};
	}

	tryAcquire(): UnlockFn | null {
		if (this.isLocked()) {
			return null;
		}

		this.locked = true;
		this.detectDeadlock();

		return () => {
			this.unlock();
		};
	}

	async withLock<T>(fn: () => Promise<T>): Promise<T> {
		let lock: UnlockFn | null = null;

		try {
			lock = await this.acquire();
			return await fn();
		} finally {
			lock?.();
		}
	}

	isLocked(): boolean {
		return this.locked;
	}

	private detectDeadlock(): void {
		if (this.timeout === undefined) {
			return;
		}

		this.timer = setTimeout(() => {
			this.timer = null;
			this.deadlocked = true;

			const error = new Error('Deadlock timeout');
			let current = this.queue.pop();

			while (current) {
				current.reject(error);
				current = this.queue.pop();
			}
		}, this.timeout);
	}

	private unlock(): void {
		this.deadlocked = false;

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		if (this.queue.length > 0) {
			const next = this.queue.pop()!;
			next.resolve();
		} else {
			this.locked = false;
		}
	}
}
