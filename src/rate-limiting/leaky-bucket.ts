import { clearInterval } from 'node:timers';
import { createDeferred, type Deferred } from '../utils/deferred.ts';

export interface LeakyBucketOptions {
	capacity: number; // max cost units that can be queued
	drainRate: number; // cost units per second
}

export class LeakyBucket {
	private interval: NodeJS.Timeout | null = null;
	private queue: [cost: number, resolver: Deferred<void>][] = [];
	private totalCost: number = 0;

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

			const front = this.queue[0];
			front[0] -= 1;
			this.totalCost -= 1;

			if (front[0] <= 0) {
				this.queue.shift()![1].resolve();
			}
		}, period);
	}

	private stopDrain(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	async acquire(cost: number = 1): Promise<void> {
		if (this.totalCost + cost > this.options.capacity) {
			throw new Error(`LeakyBucket overflow: capacity ${this.options.capacity} exceeded`);
		}

		const deferred = createDeferred<void>();
		this.queue.push([cost, deferred]);
		this.totalCost += cost;
		this.startDrain();

		return deferred.promise;
	}

	pending(): number {
		return this.totalCost;
	}

	isFull(): boolean {
		return this.totalCost >= this.options.capacity;
	}
}
