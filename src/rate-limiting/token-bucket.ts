import { clearInterval } from 'node:timers';
import { createDeferred, type Deferred } from '../utils/deferred.ts';

export interface TokenBucketOptions {
	capacity: number;
	refillRate: number; // tokens per second
}

export class TokenBucket {
	private interval: NodeJS.Timeout | null = null;
	private count: number;
	private queue: [count: number, resolver: Deferred<void>][] = [];

	constructor(private options: TokenBucketOptions) {
		// Initialize with capacity, start full
		this.count = options.capacity;
	}

	private startRefill(): void {
		if (this.interval) {
			return;
		}

		const period = (1 / this.options.refillRate) * 1_000;

		this.interval = setInterval(() => {
			if (this.isFull()) {
				this.stopRefill();
				return;
			}

			this.count += 1;
			this.fulfillPending();
		}, period);
	}

	private stopRefill(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	private fulfillPending(): void {
		while (this.queue.length > 0 && this.available() > 0) {
			const peek = this.queue.at(0)!;
			const [count] = peek;

			if (count > this.available()) {
				break;
			}

			const [tokens, resolver] = this.queue.shift()!;
			this.consume(tokens);
			resolver.resolve();
		}
	}

	private consume(tokens: number): boolean {
		this.startRefill();

		if (this.available() >= tokens) {
			this.count -= tokens;
			return true;
		}

		return false;
	}

	async acquire(tokens: number = 1): Promise<void> {
		// Wait until enough tokens are available, then consume

		if (this.consume(tokens)) {
			return;
		}

		const deferred = createDeferred<void>();

		this.queue.push([tokens, deferred]);

		return deferred.promise;
	}

	tryAcquire(tokens: number = 1): boolean {
		// Non-blocking — consume if available, return false otherwise
		return this.consume(tokens);
	}

	available(): number {
		return this.count;
	}

	isFull() {
		return this.available() >= this.options.capacity;
	}
}
