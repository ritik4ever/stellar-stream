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

## Scoped security overrides

Stellar SDK 14 requests `toml` 3, which has known advisories. The manifest
overrides only that SDK's parser to `toml` 5.0.0, which supports Node.js 20.
The SDK resolver compatibility test exercises a real `stellar.toml` response.
Storybook's action addon similarly receives `uuid` 11.1.1 to resolve its
development dependency advisory. Review these overrides when upgrading either
parent package; remove them once the parent package uses a patched version.

After any dependency change, run both `npm audit --omit=dev` and `npm audit`
to check production and development dependencies. Do not use
`npm audit fix --force` for a routine lockfile refresh.
