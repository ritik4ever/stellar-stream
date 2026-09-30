# Changelog

## [1.1.0](https://github.com/ritik4ever/stellar-stream/compare/frontend-v1.0.0...frontend-v1.1.0) (2026-09-30)


### Features

* [FEATURE] Add dark/light theme toggle with system preference ([#753](https://github.com/ritik4ever/stellar-stream/issues/753)) ([#1288](https://github.com/ritik4ever/stellar-stream/issues/1288)) ([63e2d94](https://github.com/ritik4ever/stellar-stream/commit/63e2d94ce5c1d5ceb51eacd5be01f84de4604f7b))
* Add bundle visualizer and enhance contract CI ([84cd3d4](https://github.com/ritik4ever/stellar-stream/commit/84cd3d4e6b97cd7b0422ea9f58a64995e3dace85))
* Add CODE_OF_CONDUCT.md/ Add CONTRACT_BINDINGS.md/ Add semantic-release/  Add SECURITY.md ([e683f94](https://github.com/ritik4ever/stellar-stream/commit/e683f9410d992506fa7d2ad276a67acf6b265de8))
* Add label filtering and sorting to IssueBacklog ([#461](https://github.com/ritik4ever/stellar-stream/issues/461)) ([9012a84](https://github.com/ritik4ever/stellar-stream/commit/9012a8470cb0813792c09534ba9f4c4ddcbfe520))
* Add live stream progress bar with per-second countdown timer ([252a3c1](https://github.com/ritik4ever/stellar-stream/commit/252a3c1f0aa578d3d67ff20dd645299425a1cb42))
* Add npm audit and cargo audit to CI security gate ([#419](https://github.com/ritik4ever/stellar-stream/issues/419)) ([62049d9](https://github.com/ritik4ever/stellar-stream/commit/62049d943063435419c3ec95bfa9cf9f65991b5c))
* Add Storybook for all reusable frontend components [[#406](https://github.com/ritik4ever/stellar-stream/issues/406)] ([fb5f5f8](https://github.com/ritik4ever/stellar-stream/commit/fb5f5f8e5e861f7ef1538bf5bedd0c52d1d8c2cb))
* Add stream fee preview ([b033d52](https://github.com/ritik4ever/stellar-stream/commit/b033d5243867fb3fa33c69681fa75232d0f9b86a))
* Add WebSocket push for real-time stream progress ([#351](https://github.com/ritik4ever/stellar-stream/issues/351)) ([c9c6f10](https://github.com/ritik4ever/stellar-stream/commit/c9c6f10a0db52fbb7dea70a63d0dd6f27005ccef))
* Batch claims, table columns, CSP, and reconciliation interval ([d7c0566](https://github.com/ritik4ever/stellar-stream/commit/d7c05660dda46868c7724d893eaeef1320dddf74))
* **ci:** Add Playwright E2E workflow with Docker Compose stack ([f7a5637](https://github.com/ritik4ever/stellar-stream/commit/f7a5637b1f516d2d200845eaab49de17c9b9e583))
* **frontend:** Add stale-while-revalidate caching to API client ([7e8d263](https://github.com/ritik4ever/stellar-stream/commit/7e8d26399563176be99bab8c7d742c9714b10ffb))
* **frontend:** Wire Soroban claim tx hash to backend via reconcile endpoint ([#322](https://github.com/ritik4ever/stellar-stream/issues/322)) ([160e08a](https://github.com/ritik4ever/stellar-stream/commit/160e08a4ecda4cad376501869148710781ee6f97))
* Generate and commit TypeScript contract bindings from ABI ([7d52e10](https://github.com/ritik4ever/stellar-stream/commit/7d52e10f4ed2adce57ea469683540ed3e3fdeaff))
* Implement draft recovery banner with autosave functionality ([4abf71c](https://github.com/ritik4ever/stellar-stream/commit/4abf71c631f80ff9b5485615df8f039204f49c78))
* Implement four open source contributions ([1edd1c2](https://github.com/ritik4ever/stellar-stream/commit/1edd1c265994d3eb2507970e37d72f06b3ed7137))
* Implement security and infrastructure improvements ([ef3a2b6](https://github.com/ritik4ever/stellar-stream/commit/ef3a2b6efc4dad09cc053266039b1fd47631bb95))
* Implement SenderDashboard with stream analytics and activity feed ([9275174](https://github.com/ritik4ever/stellar-stream/commit/927517465e6d0cf71bd827a1d7676c347adc51f0)), closes [#392](https://github.com/ritik4ever/stellar-stream/issues/392)
* Resolve issues [#328](https://github.com/ritik4ever/stellar-stream/issues/328), [#329](https://github.com/ritik4ever/stellar-stream/issues/329), [#331](https://github.com/ritik4ever/stellar-stream/issues/331), [#334](https://github.com/ritik4ever/stellar-stream/issues/334) — cliff support, split stream UI, metadata display, lifecycle test ([66a9ef3](https://github.com/ritik4ever/stellar-stream/commit/66a9ef32751a946ac6f5e0dc6bde48abea1abc20))
* Skeleton rows, React.memo, reduced-motion, EditStartTimeModal validation ([0b33817](https://github.com/ritik4ever/stellar-stream/commit/0b338175902bd675deaf3eef65578905c02642ae)), closes [#396](https://github.com/ritik4ever/stellar-stream/issues/396) [#397](https://github.com/ritik4ever/stellar-stream/issues/397) [#403](https://github.com/ritik4ever/stellar-stream/issues/403) [#405](https://github.com/ritik4ever/stellar-stream/issues/405)


### Bug Fixes

* **364,399:** Gzip middleware confirmed + StreamDetailDrawer Stellar Expert tx links ([a2cd8b8](https://github.com/ritik4ever/stellar-stream/commit/a2cd8b8cc9ed59bac127ed9a54b6dff3823f9f74))
* Add happy-dom dep, extract webhookSignature module, clean up worker ([e1d7767](https://github.com/ritik4ever/stellar-stream/commit/e1d7767fcb944392cbbbfcee6c07384084669053))
* **backend:** Resolve merge conflict with main for metrics endpoints ([71665cb](https://github.com/ritik4ever/stellar-stream/commit/71665cbaddc1dfd231353c60627b7b60f919f392))
* Format percentComplete with consistent precision in StreamsTable ([c89c9c0](https://github.com/ritik4ever/stellar-stream/commit/c89c9c00c45383ab9ca25411d21134f7efde44e9))
* Format vestedAmount with consistent 6-decimal precision in StreamsTable ([526aaaa](https://github.com/ritik4ever/stellar-stream/commit/526aaaa285be14843c49bb8c95daca3dc00eb125))
* **frontend:** Address review comments and fix duration logic in SenderDashboard ([90f3f9c](https://github.com/ritik4ever/stellar-stream/commit/90f3f9c2d90746ef712883bef01ecdf78a4a87cd))
* **frontend:** Render estimatedEndLabel and increase docstring coverage ([42c8b95](https://github.com/ritik4ever/stellar-stream/commit/42c8b95c971959da1b087fdad6d6bd5493630516))
* **frontend:** Resolve unit test suite failures and add api/websocket/contract mocking ([95c7b59](https://github.com/ritik4ever/stellar-stream/commit/95c7b59fa884bc82f6a0a1de28486ae79f907a4d))
* Remove duplicate imports in StreamsTable test, align error message with test ([2b4c6a2](https://github.com/ritik4ever/stellar-stream/commit/2b4c6a28870d7218215cee9d76b3c75a07f4bc9f))
* Resolve 18 failing tests across backend and frontend ([51e81f3](https://github.com/ritik4ever/stellar-stream/commit/51e81f3c030ad9cd25ab29caddae5d0e3c7dab3d))
* Resolve all CodeRabbit review comments and CI issues ([f206e41](https://github.com/ritik4ever/stellar-stream/commit/f206e41c7ea2e1e496265d588ebfccee2c33ee94))
* Resolve ERR_REQUIRE_ESM in frontend tests ([6b4ed11](https://github.com/ritik4ever/stellar-stream/commit/6b4ed119a211300e9b5df13216e152076de237e4)), closes [#304](https://github.com/ritik4ever/stellar-stream/issues/304)
* Resolve issue [#1234](https://github.com/ritik4ever/stellar-stream/issues/1234) - restore frontend dependency validation ([#1248](https://github.com/ritik4ever/stellar-stream/issues/1248)) ([f077c30](https://github.com/ritik4ever/stellar-stream/commit/f077c30f740772552bd2e5b10e4572734e18a57e))
* Resolve issue [#738](https://github.com/ritik4ever/stellar-stream/issues/738) ([d22924d](https://github.com/ritik4ever/stellar-stream/commit/d22924ddddd1c8b37ba05ffaad6c969908c43f5f))
* Resolve merge conflicts with upstream/main ([5c61e09](https://github.com/ritik4ever/stellar-stream/commit/5c61e092e1a1190d14b8dc5be449d799efb3c02c))
* Resolve TypeScript build errors causing CI failures ([583379c](https://github.com/ritik4ever/stellar-stream/commit/583379c326a57528cb0ef2241b9eb8be30f12b16))
* Use toFixed(2) directly for percentComplete and vestedAmount display ([461f948](https://github.com/ritik4ever/stellar-stream/commit/461f9481436448ac1c25ba834e3646794133fc44))
* Use unfiltered total count for EmptyState; stable scroll handler; tests ([7b91434](https://github.com/ritik4ever/stellar-stream/commit/7b914340dc7c22f7f14a404d7871e5d31af12955))


### Documentation

* Add JSDoc docstrings to all undocumented functions across backend and frontend ([1c81d69](https://github.com/ritik4ever/stellar-stream/commit/1c81d698e82bdae5e5b03654efa4a0b25068e2d4))
* Update BULK_SELECTION docs and add keyboard shortcuts ([#807](https://github.com/ritik4ever/stellar-stream/issues/807)) ([4b23ca1](https://github.com/ritik4ever/stellar-stream/commit/4b23ca1b057a6700796f95df0f13fb486126ff2b))


### Tests

* Add EditStartTimeModal validation and save flow tests ([edf6088](https://github.com/ritik4ever/stellar-stream/commit/edf60881561d2a960496917a53621d5a5ff268c3))
* Add unit tests for StreamMetricsChart data series and empty state ([08fa38b](https://github.com/ritik4ever/stellar-stream/commit/08fa38b7dbdc4f5482232153ee47bcd390390b95))
* Add unit tests for validateEnv/ StreamsTable – cancel/ RecipientDashboard / CreateStreamForm ([06a8d6e](https://github.com/ritik4ever/stellar-stream/commit/06a8d6e137b9bb69e77b1cbd66747f4947e81b78))
* **ci:** Add MSW /api/config handler; fix IssueBacklog tests; exclude tests from tsc; guard VitePWA in CI; add StreamsTable optional props ([9ab39df](https://github.com/ritik4ever/stellar-stream/commit/9ab39df86a98979382327982f6a3c68b35a35109))
* Extend API test coverage for errors and auth headers ([4e2f201](https://github.com/ritik4ever/stellar-stream/commit/4e2f201ec761c969e81690b74c19bdb7a26a2e5f))
* **frontend:** Add SenderDashboard test coverage and creation entry point ([00319a6](https://github.com/ritik4ever/stellar-stream/commit/00319a641bd194fd0559be92bd38838f7558e75d))
* **frontend:** Add SenderDashboard test coverage and resolve merge conflicts ([2e9cd1a](https://github.com/ritik4ever/stellar-stream/commit/2e9cd1a0abcb7e89e5788b6f7ac111b2d1b04f23))


### Build System

* **deps:** Bump the all-dependencies group ([#1258](https://github.com/ritik4ever/stellar-stream/issues/1258)) ([271f008](https://github.com/ritik4ever/stellar-stream/commit/271f00851522336903736cd828012e3853834efd))


### CI/CD

* Add Lighthouse CI performance budget for frontend ([e404491](https://github.com/ritik4ever/stellar-stream/commit/e40449179b4f6df57fdeba81edf4b3db808dcf6b))


### Chores

* **eslint:** Add flat config with typescript and react rules, fix core compilation bugs ([11476ba](https://github.com/ritik4ever/stellar-stream/commit/11476ba6c54080f9d2dc10c278f1159c559d1b78))
