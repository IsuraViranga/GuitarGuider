// Error tracking (Sentry): unexpected errors in the app reach Sentry, without personal data.
// On only when VITE_SENTRY_DSN is set when the app is built (Netlify's environment); otherwise
// nothing is loaded or sent. The Sentry code is fetched separately, after the app has started.

export function startErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  void import('@sentry/react')
    .then((Sentry) =>
      Sentry.init({
        dsn,
        environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? 'production',
      }),
    )
    .catch(() => {
      // Blocked by an ad blocker or offline: the app works the same without it.
    })
}
