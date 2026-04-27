export interface Deferred<T = unknown> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(err: any): void;
}

/**
 * Creates a deferred object that includes a promise along with its resolve and reject methods.
 * The resolve and reject methods can be used to manually settle the promise.
 *
 * @template T The type of the value that the promise resolves to.
 * @return {Deferred<T>} An object containing:
 * - `promise`: The promise that can be resolved or rejected.
 * - `resolve`: A function to resolve the promise with a value of type T.
 * - `reject`: A function to reject the promise with an error.
 */
export function createDeferred<T = unknown>(): Deferred<T> {
	let resolveFn!: (value: T) => void;
	let rejectFn!: (err: any) => void;

	const promise = new Promise<T>((resolve, reject) => {
		resolveFn = resolve;
		rejectFn = reject;
	});

	return {
		promise,
		resolve: resolveFn,
		reject: rejectFn,
	};
}
