/**
 * Generic lazy-loader utility.
 * Wraps dynamic import() and caches the resolved module so subsequent
 * calls return instantly without re-importing.
 *
 * Usage:
 *   const mod = await lazyLoad(() => import('./heavy/heavy.service'));
 *   const instance = new mod.HeavyService();
 */
export class LazyLoader<T> {
  private cache: T | null = null;
  private loading: Promise<T> | null = null;

  constructor(private readonly factory: () => Promise<T>) {}

  async load(): Promise<T> {
    if (this.cache) return this.cache;
    if (this.loading) return this.loading;

    this.loading = this.factory().then(mod => {
      this.cache = mod;
      this.loading = null;
      return mod;
    });

    return this.loading;
  }

  /** Clear cache (useful in tests) */
  reset(): void {
    this.cache = null;
    this.loading = null;
  }
}

/**
 * Pre-built lazy loaders for each heavy feature module.
 * Import these instead of importing the modules directly at the top level.
 */
export const lazyModules = {
  analytics:   new LazyLoader(() => import('../analytics/analytics.module')),
  mfa:         new LazyLoader(() => import('../auth/mfa/mfa.module')),
  computeBridge: new LazyLoader(() => import('../analytics/compute-bridge.service')),
};