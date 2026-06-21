/** Race a fetch against a deadline — slow providers return fallback instead of blocking the dossier.
 *
 * NOTE: `promise` is a pre-created Promise and cannot be aborted here.
 * For fetch()-backed calls use `dossierFetch` below, which wires an AbortController
 * so the underlying connection is actually torn down when the timeout fires.
 */
export function withFetchTimeout<T>(promise: Promise<T>, fallback: T, ms = 8000): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timerId = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timerId)),
    timeout,
  ]);
}

/**
 * Wrap a fetch-like factory function with a timeout that actually aborts the
 * underlying HTTP connection via AbortController.
 *
 * `fn` receives an AbortSignal it must pass to fetch() (or any other
 * AbortSignal-aware API).  When the deadline fires the signal is aborted and
 * `fallback` is returned — no dangling connection left open.
 */
export function dossierFetch<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  ms = 8000
): Promise<T> {
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<T>((resolve) => {
    timerId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, ms);
  });

  const work = fn(controller.signal).catch(() => fallback);

  return Promise.race([
    work.finally(() => clearTimeout(timerId)),
    timeout,
  ]);
}
