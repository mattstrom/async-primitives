export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
	failureThreshold: number;
	resetTimeoutMs: number;
}

interface Stats {
	successes: number;
	failures: number;
}

export class CircuitBreaker {
	private state: CircuitState = 'closed';
	private stats: Stats = {
		successes: 0,
		failures: 0,
	};

	private openTimer: NodeJS.Timeout | null = null;

	constructor(private options: CircuitBreakerOptions) {}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		// Pass-through in closed, fail-fast in open, test in half-open

		if (this.getState() === 'open') {
			throw new Error('Circuit open');
		}

		try {
			const result = await fn();

			this.incrementSuccess();

			return result;
		} catch (err) {
			this.incrementFailure();
			throw err;
		}
	}

	getState(): CircuitState {
		return this.state;
	}

	setState(state: CircuitState): void {
		if (this.openTimer) {
			clearTimeout(this.openTimer);
			this.openTimer = null;
		}

		switch (state) {
			case 'open': {
				this.state = 'open';
				this.openTimer = setTimeout(() => {
					this.setState('half-open');
				}, this.options.resetTimeoutMs);
				break;
			}
			case 'half-open': {
				this.state = 'half-open';
				break;
			}
			case 'closed': {
				this.state = 'closed';
				this.stats.failures = 0;
				break;
			}
			default: {
				throw new Error('Invalid circuit state');
			}
		}
	}

	getStats(): Stats {
		return this.stats;
	}

	incrementSuccess() {
		this.stats.successes += 1;

		if (this.getState() === 'half-open') {
			this.setState('closed');
		}
	}

	incrementFailure() {
		this.stats.failures += 1;

		if (this.getState() === 'half-open') {
			this.setState('open');
		} else if (this.stats.failures >= this.options.failureThreshold) {
			this.setState('open');
		}
	}
}
