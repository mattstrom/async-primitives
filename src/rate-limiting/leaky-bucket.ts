import { clearInterval } from 'node:timers';
import { createDeferred, type Deferred } from '../utils/deferred.ts';

export interface LeakyBucketOptions {
	capacity: number; // max queue depth
	drainRate: number; // requests per second
}

export class LeakyBucket {
	private interval: NodeJS.Timeout | null = null;
	private queue: Deferred<void>[] = [];

	constructor(private options: LeakyBucketOptions) {}

	private startDrain(): void {
		if (this.interval) {
			return;
		}

		const period = (1 / this.options.drainRate) * 1_000;

		this.interval = setInterval(() => {
			if (this.queue.length === 0) {
				this.stopDrain();
				return;
			}

			this.queue.shift()!.resolve();
		}, period);
	}

	private stopDrain(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	async acquire(): Promise<void> {
		if (this.isFull()) {
			throw new Error(`LeakyBucket overflow: capacity ${this.options.capacity} exceeded`);
		}

		const deferred = createDeferred<void>();
		this.queue.push(deferred);
		this.startDrain();

		return deferred.promise;
	}

	pending(): number {
		return this.queue.length;
	}

	isFull(): boolean {
		return this.queue.length >= this.options.capacity;
	}
}
