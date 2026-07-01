# Frontend Performance Guide

## Bundle Analysis

To analyze the frontend bundle size and identify large dependencies:

```bash
cd frontend
npm run build:analyze
```

This generates an interactive visualization (`dist/stats.html`) showing:
- Module sizes and their contribution to the final bundle
- Dependency tree and hierarchical breakdown
- Gzip compression estimates
- Opportunities for code-splitting and optimization

### Running Bundle Analysis

The `build:analyze` script:
1. Compiles TypeScript
2. Builds the Vite production bundle with visualization enabled
3. Automatically opens the bundle analysis HTML report

Results are saved in `frontend/dist/stats.html`.

## Key Metrics

Monitor these metrics when making bundle-related changes:

- **Total Bundle Size**: Target < 500KB (gzipped < 150KB)
- **Main Chunk**: Should remain minimal; route chunks carry the bulk
- **Vendor Chunk**: Contains third-party dependencies (React, Stellar SDK, etc.)

## Known Large Dependencies

1. **@stellar/stellar-sdk** (~250KB gzipped)
   - Required for Stellar operations
   - Cannot be removed without changing core functionality

2. **recharts** (~80KB gzipped)
   - Used for stream visualization charts
   - Consider alternatives (lightweight charting libraries) if bundle size is critical

3. **react + react-dom** (~50KB gzipped combined)
   - Core framework, cannot be reduced

## Optimization Strategies

### Code Splitting
- Routes are lazy-loaded using React Router (see `App.tsx`)
- Heavy components should use dynamic imports when not immediately needed
- Avoid importing entire libraries when only specific functions are used

### Tree-shaking
- Ensure dependencies support ES modules
- Import specific items rather than entire namespaces
- Remove unused dependencies regularly

### Monitoring
- Run `npm run build:analyze` before and after making dependency changes
- Track gzipped size in CI/CD pipelines
- Compare bundle impact of alternative packages before adding new deps

## Build Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Production build without analysis |
| `npm run build:analyze` | Production build with visualization (opens report) |
| `npm run dev` | Development server with HMR |
| `npm test` | Run unit tests |

## Related Documentation

- [Vite Build Guide](https://vitejs.dev/guide/build.html)
- [Bundle Visualizer Docs](https://github.com/btd/rollup-plugin-visualizer)
