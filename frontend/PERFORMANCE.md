# Frontend Performance

## Bundle Size

| Metric | Size |
|--------|------|
| Gzipped JS bundle | ~100 KB |
| Gzipped CSS | ~5 KB |

> Update these numbers after running `npm run build:analyze` on the latest build.

## Bundle Analysis

Run `npm run build:analyze` to generate an interactive treemap of the bundle.

## Optimization Notes

- React Router routes are lazy-loaded using `React.lazy` and `Suspense`
- Images use lazy loading via `loading="lazy"`
- PWA service worker caches API responses for offline-first experience
