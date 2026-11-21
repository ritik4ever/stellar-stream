# Frontend dependency updates

Use Node.js 20 and npm with a fresh checkout. The frontend has its own
`package.json` and `package-lock.json`; run these commands from `frontend/`:

```sh
npm ci
npm run lint
npm test -- --run
npm run build
npm audit --omit=dev
```

`npm ci` must succeed without a local `node_modules` directory and must not
change either tracked dependency file. Investigate any failed install, test,
build, or audit and record the result in the pull request.

For an SDK or other frontend dependency upgrade, update the manifest and lockfile
together with `npm install <package>@<version>`, then repeat the commands above
after deleting `node_modules` or in a new checkout. Review the package's release
notes and the lockfile diff, especially for `@stellar/stellar-sdk` and
`@stellar/freighter-api`, because the wallet and Soroban integration depend on
their APIs. Commit both dependency files with the change.

## Current SDK audit constraint

As checked on September 26, 2026, the frontend production audit still reports
`toml` through Stellar SDK 14. The available npm audit fix upgrades the SDK to
17, which requires Node.js 22 or later; frontend CI currently runs Node.js 20.
Treat that SDK upgrade as a separate compatibility change with a Node version
decision and wallet/Soroban regression tests. Do not use `npm audit fix --force`
for a routine lockfile refresh.
