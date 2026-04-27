# @mattstrom/async-primitives

A collection of async primitives for TypeScript: semaphores, mutexes, queues, resource pools, cancellable tasks, retry with backoff, rate limiters, circuit breakers, and bounded-concurrency mapping.

## Installation

```bash
npm install @mattstrom/async-primitives
```

## Primitives

- [Semaphore](#semaphore)
- [Mutex](#mutex)
- [AsyncQueue](#asyncqueue)
- [Pipeline](#pipeline)
- [Pool](#pool)
- [CancellableTask / TaskGroup / withTimeout](#cancellation)
- [retry](#retry)
- [CircuitBreaker](#circuitbreaker)
- [pMap / pMapSemaphore](#pmap--pmapsemaphore)
- [TokenBucket](#tokenbucket)
- [SlidingWindowLimiter](#slidingwindowlimiter)
- [rateLimitedMap](#ratelimitedmap)
- [Utilities](#utilities)

---

### Semaphore

Limits the number of concurrent operations to a fixed number of permits.

```ts
import { Semaphore } from '@mattstrom/async-primitives';

const sem = new Semaphore(3); // allow 3 concurrent operations

async function fetchWithLimit(url: string) {
	await sem.acquire();
	try {
		return await fetch(url);
	} finally {
		sem.release();
	}
}
```

`Semaphore` implements `Disposable` — callers waiting in the queue are dropped when disposed.

---

### Mutex

A mutual-exclusion lock. Only one caller holds the lock at a time; others wait in FIFO order.

```ts
import { Mutex } from '@mattstrom/async-primitives';

const mutex = new Mutex();

// Manual acquire/release
const unlock = await mutex.acquire();
try {
	// critical section
} finally {
	unlock();
}

// Convenience wrapper
await mutex.withLock(async () => {
	// critical section
});

// Non-blocking attempt
const unlock = mutex.tryAcquire();
if (unlock) {
	try {
		/* ... */
	} finally {
		unlock();
	}
}
```

Pass a `timeout` (ms) to the constructor to detect deadlocks — waiting callers are rejected with `"Deadlock timeout"` if the lock is held longer than the threshold.

---

### AsyncQueue

A FIFO queue that supports backpressure and async iteration. Producers that enqueue into a full queue are suspended until a consumer dequeues.

```ts
import { AsyncQueue } from '@mattstrom/async-primitives';

const queue = new AsyncQueue<number>(10); // capacity of 10

// Producer
async function produce() {
	for (let i = 0; i < 100; i++) {
		await queue.enqueue(i); // suspends when queue is full
	}
	queue.close();
}

// Consumer
async function consume() {
	for await (const item of queue) {
		console.log(item);
	}
}
```

---

### Pipeline

Connects a source `AsyncQueue` to a sink `AsyncQueue` through an async worker function, with controlled concurrency.

```ts
import { AsyncQueue, pipeline } from '@mattstrom/async-primitives';

const source = new AsyncQueue<string>();
const sink = new AsyncQueue<number>();

await pipeline(source, async (item) => item.length, sink, 4 /* concurrency */);
// sink is automatically closed when the source is drained
```

---

### Pool

A generic resource pool with lazy creation, FIFO waiting, and automatic cleanup.

```ts
import { Pool } from '@mattstrom/async-primitives';

const pool = new Pool({
	factory: () => createDatabaseConnection(),
	destroy: (conn) => conn.close(),
	maxSize: 10,
});

// Manual acquire/release
const conn = await pool.acquire();
try {
	await conn.query('SELECT 1');
} finally {
	pool.release(conn);
}

// Convenience wrapper (recommended)
const result = await pool.withResource(async (conn) => {
	return conn.query('SELECT 1');
});

// Inspect pool state
const { size, available, pending } = pool.stats();

// Tear down the pool
await pool.destroy(); // or: await using pool = new Pool(...)
```

---

### Cancellation

#### `CancellableTask`

Wraps an `AbortSignal`-aware function with cancellation support.

```ts
import { CancellableTask } from '@mattstrom/async-primitives';

const task = new CancellableTask(async (signal) => {
	const res = await fetch('/api/data', { signal });
	return res.json();
});

const promise = task.start();
task.cancel(); // aborts the fetch
```

#### `TaskGroup`

Manages a collection of cancellable tasks.

```ts
import { TaskGroup } from '@mattstrom/async-primitives';

const group = new TaskGroup();

group.add(async (signal) => pollEndpoint(signal));
group.add(async (signal) => pollEndpoint(signal));

// Cancel everything
group.cancelAll();

// Wait for all tasks to settle
await group.waitForAll();

// Race: returns the first success, cancels the rest
const result = await group.race([(signal) => tryServer('us-east', signal), (signal) => tryServer('eu-west', signal)]);
```

#### `withTimeout`

Runs a task and cancels it if it doesn't complete within a time limit.

```ts
import { withTimeout } from '@mattstrom/async-primitives';

const result = await withTimeout(async (signal) => {
	return fetch('/slow-api', { signal }).then((r) => r.json());
}, 5000);
```

---

### retry

Retries an async function with exponential backoff and optional jitter.

```ts
import { retry } from '@mattstrom/async-primitives';

const data = await retry(() => fetch('/api/resource').then((r) => r.json()), {
	maxAttempts: 5,
	baseDelayMs: 100, // default
	maxDelayMs: 10000, // default
	jitter: true, // default
	shouldRetry: (error, attempt) => !(error instanceof AuthError),
});
```

| Option        | Default     | Description                      |
| ------------- | ----------- | -------------------------------- |
| `maxAttempts` | `Infinity`  | Maximum number of attempts       |
| `baseDelayMs` | `100`       | Initial delay in milliseconds    |
| `maxDelayMs`  | `10000`     | Maximum delay cap                |
| `jitter`      | `true`      | Randomize delay by ±50%          |
| `shouldRetry` | always true | Predicate to stop retrying early |

---

### CircuitBreaker

Prevents cascading failures by tracking successes and failures and tripping open when a threshold is exceeded. Transitions automatically from `open` → `half-open` after a reset timeout, then back to `closed` on the next success.

States:
- **closed** — requests pass through normally.
- **open** — requests fail immediately with `"Circuit open"`.
- **half-open** — one request is allowed through to probe recovery; a success closes the circuit, a failure re-opens it.

```ts
import { CircuitBreaker } from '@mattstrom/async-primitives';

const breaker = new CircuitBreaker({
	failureThreshold: 5,   // open after 5 consecutive failures
	resetTimeoutMs: 10000, // try again after 10s
});

try {
	const result = await breaker.execute(() => fetch('/api/data').then((r) => r.json()));
} catch (err) {
	if (err.message === 'Circuit open') {
		// fast-fail — upstream is unhealthy
	}
}

// Inspect state
breaker.getState();  // 'closed' | 'open' | 'half-open'
breaker.getStats();  // { successes: number, failures: number }
```

---

### pMap / pMapSemaphore

Apply an async function to every item in an array with bounded concurrency. Both functions preserve result order and reject immediately on the first error.

**`pMap`** — uses an internal queue, dispatching the next item as soon as a slot opens:

```ts
import { pMap } from '@mattstrom/async-primitives';

const results = await pMap(
	urls,
	(url) => fetch(url).then((r) => r.json()),
	4, // at most 4 in-flight at once
);
```

**`pMapSemaphore`** — starts all tasks simultaneously but gates them through a `Semaphore`, so all promises are created eagerly. Prefer `pMap` for large arrays where eager allocation is wasteful.

```ts
import { pMapSemaphore } from '@mattstrom/async-primitives';

const results = await pMapSemaphore(urls, (url) => fetch(url).then((r) => r.json()), 4);
```

---

### TokenBucket

Smooths bursts by refilling tokens at a fixed rate. Callers that exceed the rate wait until tokens are available.

```ts
import { TokenBucket } from '@mattstrom/async-primitives';

const bucket = new TokenBucket({ capacity: 10, refillRate: 5 }); // 5 tokens/sec

await bucket.acquire(); // wait for 1 token
await bucket.acquire(3); // wait for 3 tokens

// Non-blocking
if (bucket.tryAcquire()) {
	// proceed immediately
}
```

---

### SlidingWindowLimiter

Enforces a maximum number of requests within a rolling time window.

```ts
import { SlidingWindowLimiter } from '@mattstrom/async-primitives';

const controller = new AbortController();
const limiter = new SlidingWindowLimiter({
	maxRequests: 100,
	windowMs: 60_000, // 100 requests per minute
	signal: controller.signal,
});

await limiter.acquire(); // waits if the window is full

// Non-blocking
if (limiter.tryAcquire()) {
	// proceed immediately
}

// Dispose when done
controller.abort();
```

---

### rateLimitedMap

Applies an async function to each item in an array, throttled by a `TokenBucket` or `SlidingWindowLimiter`.

```ts
import { TokenBucket, rateLimitedMap } from '@mattstrom/async-primitives';

const bucket = new TokenBucket({ capacity: 10, refillRate: 10 });

const results = await rateLimitedMap(urls, (url) => fetch(url).then((r) => r.json()), bucket);
```

---

### Utilities

#### `createDeferred`

Creates a `Promise` with externalized `resolve` and `reject` — useful for bridging callback-based APIs or coordinating across async boundaries.

```ts
import { createDeferred } from '@mattstrom/async-primitives';

const deferred = createDeferred<string>();

someEmitter.once('done', (value) => deferred.resolve(value));
someEmitter.once('error', (err) => deferred.reject(err));

const result = await deferred.promise;
```

#### `delay`

A cancellable promise-based sleep.

```ts
import { delay } from '@mattstrom/async-primitives';

await delay(1000); // sleep 1s

const controller = new AbortController();
await delay(5000, controller.signal); // abortable
```

---

## Development

```bash
vp install   # install dependencies
vp test      # run tests
vp pack      # build the library
```

## License

MIT
