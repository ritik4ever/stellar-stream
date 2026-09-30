# Changelog

## [1.1.0](https://github.com/ritik4ever/stellar-stream/compare/backend-v1.0.0...backend-v1.1.0) (2026-09-30)


### Features

* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([44f7b8b](https://github.com/ritik4ever/stellar-stream/commit/44f7b8bdc1676b92f5d81e1a25c9ef6258d24ec9))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([f1c9bcc](https://github.com/ritik4ever/stellar-stream/commit/f1c9bcc5daf38f0c661b98d886a65f6c2df4a644))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([77333bf](https://github.com/ritik4ever/stellar-stream/commit/77333bfac0a5e63c93fe0bc01d7cf5b71e4720df))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([d830084](https://github.com/ritik4ever/stellar-stream/commit/d830084489698f4e35666dfe67f26fed67fe906f))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([68459bc](https://github.com/ritik4ever/stellar-stream/commit/68459bc476bdc2537716c7653f31cdf12e8a481c))
* **#440:** Add ADMIN_API_KEY validation strength check on startup ([8eb9e45](https://github.com/ritik4ever/stellar-stream/commit/8eb9e45023ceb21029fb59e0d94866d58e5cb54f))
* **#444:** Add rate limit tightening for mutation endpoints ([900e833](https://github.com/ritik4ever/stellar-stream/commit/900e8330bd7972b3fa5e9893b4e242c21321bb2f))
* **#446:** Add Redis cache layer for production multi-instance deployments ([33809d5](https://github.com/ritik4ever/stellar-stream/commit/33809d5902671577000146d13cf8cc53c92041e4))
* **#453:** Add assetCode filter to GET /api/streams ([5c0fe87](https://github.com/ritik4ever/stellar-stream/commit/5c0fe87103fde45204db2fe532d258109f5eb3b8))
* **#456:** Add stream_completed event recording when vested amount reaches total ([ae7a4b7](https://github.com/ritik4ever/stellar-stream/commit/ae7a4b76b70d18b1214068dce0007d1d259541d3))
* Add ALLOWED_ORIGINS env var for production CORS allowlist ([6fbf6e4](https://github.com/ritik4ever/stellar-stream/commit/6fbf6e4990657330fe99a12935d216c20edb83ec)), closes [#366](https://github.com/ritik4ever/stellar-stream/issues/366)
* Add Content-Type enforcement middleware for POST/PATCH routes ([#367](https://github.com/ritik4ever/stellar-stream/issues/367)) ([bb99707](https://github.com/ritik4ever/stellar-stream/commit/bb99707a6e1a9d3c11a7fcd8be552b168c9b2715))
* Add exponential backoff retry for Soroban transaction submission ([8b564bd](https://github.com/ritik4ever/stellar-stream/commit/8b564bd223de12263065b8026d347cdc94e3e62b)), closes [#353](https://github.com/ritik4ever/stellar-stream/issues/353)
* Add FTS5 full-text search endpoint ([#348](https://github.com/ritik4ever/stellar-stream/issues/348)) ([d8491bf](https://github.com/ritik4ever/stellar-stream/commit/d8491bf07d4878f3b491d72507f18fdb0044cb91))
* Add GET /api/docs/openapi.json endpoint and Swagger UI link in README ([34bdad6](https://github.com/ritik4ever/stellar-stream/commit/34bdad6eb8e43a978468d5f0d011f28e564b24bb)), closes [#376](https://github.com/ritik4ever/stellar-stream/issues/376)
* Add GET /api/streams/sender/:address and /recipient/:address endpoints ([e4ad078](https://github.com/ritik4ever/stellar-stream/commit/e4ad07883c1dd437c953a713a28b504cf41b44ad))
* Add get_stream_count view and expose onChainStreamCount via /api/stats ([45e7c3f](https://github.com/ritik4ever/stellar-stream/commit/45e7c3fc5431b0600f8cb9f575af03703b03d752))
* Add minAmount and maxAmount range filters to GET /api/streams ([56569cf](https://github.com/ritik4ever/stellar-stream/commit/56569cf30d0ff916ddd7517c2bed746cfa4b35fa))
* Add npm audit and cargo audit to CI security gate ([#419](https://github.com/ritik4ever/stellar-stream/issues/419)) ([62049d9](https://github.com/ritik4ever/stellar-stream/commit/62049d943063435419c3ec95bfa9cf9f65991b5c))
* Add pagination, streamId, and since filters to GET /api/events ([a59c26e](https://github.com/ritik4ever/stellar-stream/commit/a59c26e8f17d45ec079b48606c5ef6e9a56dcd63)), closes [#380](https://github.com/ritik4ever/stellar-stream/issues/380)
* Add POST /api/streams/:id/mark-complete manual completion endpoint ([03091e4](https://github.com/ritik4ever/stellar-stream/commit/03091e44a7af13baebddd27883f2e89a272260ef)), closes [#369](https://github.com/ritik4ever/stellar-stream/issues/369)
* Add POST /api/streams/bulk-cancel endpoint ([#381](https://github.com/ritik4ever/stellar-stream/issues/381)) ([a6a21ca](https://github.com/ritik4ever/stellar-stream/commit/a6a21cacbdcc1a5d877941da21b0502249520364))
* Add request tracing with correlation ID to all log lines ([f27613c](https://github.com/ritik4ever/stellar-stream/commit/f27613c7e18d4810bf1191fe325c244afd1cce4e))
* Add SAC validation, stream metadata, and indexer events for paused/resumed/transfer ([70724e5](https://github.com/ritik4ever/stellar-stream/commit/70724e51f47974bbf83bf15b23c9cce4abc21959))
* Add SQLite pragmas ([#360](https://github.com/ritik4ever/stellar-stream/issues/360)) and archive job cron ([#350](https://github.com/ritik4ever/stellar-stream/issues/350)) ([2b985ef](https://github.com/ritik4ever/stellar-stream/commit/2b985efc28440edd56141da5772ed2221374b9a9))
* Add stream fee preview ([b033d52](https://github.com/ritik4ever/stellar-stream/commit/b033d5243867fb3fa33c69681fa75232d0f9b86a))
* Add versioned SQL migration system ([#349](https://github.com/ritik4ever/stellar-stream/issues/349)) ([6df2980](https://github.com/ritik4ever/stellar-stream/commit/6df2980f710252f42fbabc47f9e126da5c31bc6c))
* Add WebSocket per-stream subscription and isolation tests ([5da5b11](https://github.com/ritik4ever/stellar-stream/commit/5da5b11bb7d7867ece98aa22a0d610d72af9ebc1))
* Add WebSocket push for real-time stream progress ([#351](https://github.com/ritik4ever/stellar-stream/issues/351)) ([c9c6f10](https://github.com/ritik4ever/stellar-stream/commit/c9c6f10a0db52fbb7dea70a63d0dd6f27005ccef))
* **admin:** Add DELETE /api/streams/:id endpoint for admin stream removal ([8ae938a](https://github.com/ritik4ever/stellar-stream/commit/8ae938a6404995148222a5fefc6f6e45a531f230))
* **api:** Add admin JWT stream metrics endpoint ([d7ce410](https://github.com/ritik4ever/stellar-stream/commit/d7ce410e7a4682321d81c982a1c98d84e20c0afd))
* **backend:** Add event deduplication by ledger sequence ([#145](https://github.com/ritik4ever/stellar-stream/issues/145)) ([f5ea252](https://github.com/ritik4ever/stellar-stream/commit/f5ea25263fa2c7636d278e270817a523d5e04619))
* **backend:** Add GET /api/streams/compare endpoint ([#1254](https://github.com/ritik4ever/stellar-stream/issues/1254)) ([655ede9](https://github.com/ritik4ever/stellar-stream/commit/655ede9dacc5fb356f3460d6ccc6a751eeca14f4))
* **backend:** Add sort and order query params to stream list ([1e542d3](https://github.com/ritik4ever/stellar-stream/commit/1e542d35248b573dcba3ac3a1f6ab1d8a35bc903))
* **backend:** Implement dynamic asset allowlist with admin JWT endpoints ([d1ac324](https://github.com/ritik4ever/stellar-stream/commit/d1ac324ad701a2afe211c24a20cfb56a826344f0))
* **backend:** Wire Soroban create_stream contract call with simulation, signing, and SQLite fallback ([85a103a](https://github.com/ritik4ever/stellar-stream/commit/85a103a8a60b55c83da384e255f5beec62a10dba))
* Batch claims, table columns, CSP, and reconciliation interval ([d7c0566](https://github.com/ritik4ever/stellar-stream/commit/d7c05660dda46868c7724d893eaeef1320dddf74))
* **contracts:** Add structured event schema with actor+timestamp ([a3f582c](https://github.com/ritik4ever/stellar-stream/commit/a3f582cf5e2b01001c5ffa7ae2e09a8606b70908))
* **database:** Migrate SQLite schema to support optional PostgreSQL backend ([27eecb0](https://github.com/ritik4ever/stellar-stream/commit/27eecb0b8643a140c467ae70b547471d2b4a86a5))
* Enhance rate limiting handlers to support next function ([488464b](https://github.com/ritik4ever/stellar-stream/commit/488464b396ef96a8cd759ced495b005f76624776))
* Expose SQLite restore schema-check outcome signal ([#1261](https://github.com/ritik4ever/stellar-stream/issues/1261)) ([f30fb38](https://github.com/ritik4ever/stellar-stream/commit/f30fb38a76bba8f71a231ebaaa0f53460e1e6faf))
* **frontend:** Wire Soroban claim tx hash to backend via reconcile endpoint ([#322](https://github.com/ritik4ever/stellar-stream/issues/322)) ([160e08a](https://github.com/ritik4ever/stellar-stream/commit/160e08a4ecda4cad376501869148710781ee6f97))
* Implement cursor-based pagination for global events and add integration tests ([#239](https://github.com/ritik4ever/stellar-stream/issues/239), [#240](https://github.com/ritik4ever/stellar-stream/issues/240), [#238](https://github.com/ritik4ever/stellar-stream/issues/238)) ([980e7af](https://github.com/ritik4ever/stellar-stream/commit/980e7afeefb6057a572f64f197b62275505b36f5))
* Implement security and infrastructure improvements ([ef3a2b6](https://github.com/ritik4ever/stellar-stream/commit/ef3a2b6efc4dad09cc053266039b1fd47631bb95))
* **indexer:** Expose monitoring outcome signal for RPC rate limit / disconnection ([#1227](https://github.com/ritik4ever/stellar-stream/issues/1227)) ([#1262](https://github.com/ritik4ever/stellar-stream/issues/1262)) ([4e21648](https://github.com/ritik4ever/stellar-stream/commit/4e21648238c04a9a89e2f08b26620dbb9d734a9c))
* **indexer:** Replace polling with Stellar RPC event fetching ([dad123a](https://github.com/ritik4ever/stellar-stream/commit/dad123a8e567aec169888adb761f173c969afcfe))
* **observability:** Record webhook monitoring outcomes ([#1252](https://github.com/ritik4ever/stellar-stream/issues/1252)) ([22ab709](https://github.com/ritik4ever/stellar-stream/commit/22ab709c40860e6c6db72ece5d0dae351d7db7e5))
* **operations:** Record SQLite backup interrupted outcomes and document in runbook (SSB-2026-274) ([#1270](https://github.com/ritik4ever/stellar-stream/issues/1270)) ([9ad54f9](https://github.com/ritik4ever/stellar-stream/commit/9ad54f9771da9a497b8a1c8b263ce085d537ffb7))
* **ops:** Network-aware deployment config with fail-fast recovery (SSB-2026-262) ([#1274](https://github.com/ritik4ever/stellar-stream/issues/1274)) ([07cfd1c](https://github.com/ritik4ever/stellar-stream/commit/07cfd1cd469e33168fd56ef3ae592de2978c3351))
* **ops:** Record deployment configuration outcomes ([#1207](https://github.com/ritik4ever/stellar-stream/issues/1207)) ([#1276](https://github.com/ritik4ever/stellar-stream/issues/1276)) ([7a73c15](https://github.com/ritik4ever/stellar-stream/commit/7a73c15237bb23403a7bbd33e942fde466a20dc1))
* **ops:** Record fresh startup and verify SQLite backups ([#1273](https://github.com/ritik4ever/stellar-stream/issues/1273)) ([36d4fa1](https://github.com/ritik4ever/stellar-stream/commit/36d4fa1c3a577bf411097d4a753263f988ff0be6))
* **ops:** Validate monitoring config and document webhook recovery ([#1269](https://github.com/ritik4ever/stellar-stream/issues/1269)) ([9c3195a](https://github.com/ritik4ever/stellar-stream/commit/9c3195ae9a55badf0979be244514ab8dcec17712))
* **ops:** Validate secrets rotation in clean environment ([#1263](https://github.com/ritik4ever/stellar-stream/issues/1263)) ([c1ad219](https://github.com/ritik4ever/stellar-stream/commit/c1ad2198d62b90164b1241319d736063a9594bef)), closes [#1209](https://github.com/ritik4ever/stellar-stream/issues/1209)
* Resolve issues [#328](https://github.com/ritik4ever/stellar-stream/issues/328), [#329](https://github.com/ritik4ever/stellar-stream/issues/329), [#331](https://github.com/ritik4ever/stellar-stream/issues/331), [#334](https://github.com/ritik4ever/stellar-stream/issues/334) — cliff support, split stream UI, metadata display, lifecycle test ([66a9ef3](https://github.com/ritik4ever/stellar-stream/commit/66a9ef32751a946ac6f5e0dc6bde48abea1abc20))


### Bug Fixes

* **#711:** Enforce sender ownership on cancel endpoint and fix pre-existing blockers ([174c1d6](https://github.com/ritik4ever/stellar-stream/commit/174c1d6374ab130013c5054b39c0b86d11cad15b))
* Add completed to eventType enum and reject blank streamId in events schema ([dc32371](https://github.com/ritik4ever/stellar-stream/commit/dc32371c1b736338c0a6506f20424aa98efc5b0a))
* Add completed to eventType enum and reject blank streamId in events schema ([a80f76d](https://github.com/ritik4ever/stellar-stream/commit/a80f76dc217255c18fc4f69638ac05cd67e95338))
* Add happy-dom dep, extract webhookSignature module, clean up worker ([e1d7767](https://github.com/ritik4ever/stellar-stream/commit/e1d7767fcb944392cbbbfcee6c07384084669053))
* Await async updateStreamStartAt calls in tests ([42a78a1](https://github.com/ritik4ever/stellar-stream/commit/42a78a1bd4d89531aa8350e9ca2236f8f9425cd1))
* Await async updateStreamStartAt calls in tests ([535bab8](https://github.com/ritik4ever/stellar-stream/commit/535bab80161db551ce1ecad53cdae8675cf5faea))
* **backend:** Define boundary behavior for Stream search endpoint ([#1244](https://github.com/ritik4ever/stellar-stream/issues/1244)) ([a5ec784](https://github.com/ritik4ever/stellar-stream/commit/a5ec784ee6e8693d27fd3b5a074fea5d588062ae))
* **backend:** Resolve merge conflict with main for metrics endpoints ([71665cb](https://github.com/ritik4ever/stellar-stream/commit/71665cbaddc1dfd231353c60627b7b60f919f392))
* **backend:** Resolve unhandled promise rejections and test suite issues ([778896d](https://github.com/ritik4ever/stellar-stream/commit/778896d356d6d348239ce6ed9be83c9f236b21df))
* Enforce minimum stream duration validation ([6e1e10a](https://github.com/ritik4ever/stellar-stream/commit/6e1e10a190affe44055bb101b6f24bd8bff3115d))
* Harden webhook urls and add GitHub templates ([edffa4a](https://github.com/ritik4ever/stellar-stream/commit/edffa4ad6c502080f2ddd6966455866fa3fcd1ed))
* Impl ([decebeb](https://github.com/ritik4ever/stellar-stream/commit/decebeb32e80923a7a2ca2169798ae337aacba4e))
* Implement issues [#214](https://github.com/ritik4ever/stellar-stream/issues/214), [#213](https://github.com/ritik4ever/stellar-stream/issues/213), [#218](https://github.com/ritik4ever/stellar-stream/issues/218), [#220](https://github.com/ritik4ever/stellar-stream/issues/220) ([fbcfd63](https://github.com/ritik4ever/stellar-stream/commit/fbcfd63f13398ade3f5ec045efcbfb4fa8ca2ce1))
* **ops:** Preflight deployment network and RPC config ([#1278](https://github.com/ritik4ever/stellar-stream/issues/1278)) ([ba6c6c3](https://github.com/ritik4ever/stellar-stream/commit/ba6c6c38de3d479dbb6d155ff039ab268a96a9ea))
* **ops:** Validate SQLite restore in clean environment ([#1219](https://github.com/ritik4ever/stellar-stream/issues/1219)) ([#1266](https://github.com/ritik4ever/stellar-stream/issues/1266)) ([dabe937](https://github.com/ritik4ever/stellar-stream/commit/dabe9379db6da73f0c2ae11af274ccc322447aa9))
* Resolve 18 failing tests across backend and frontend ([51e81f3](https://github.com/ritik4ever/stellar-stream/commit/51e81f3c030ad9cd25ab29caddae5d0e3c7dab3d))
* Resolve merge conflict, dedupe startServer, sanitize cancel errors, tighten test assertions, fix paused-duration vesting calc ([83fb9ba](https://github.com/ritik4ever/stellar-stream/commit/83fb9bad57aa938d62dcf39a06dd7e74a1ea5d6c))
* Resolve merge conflicts with upstream/main ([5c61e09](https://github.com/ritik4ever/stellar-stream/commit/5c61e092e1a1190d14b8dc5be449d799efb3c02c))
* Resolve pre-existing test failures across multiple test files ([984f7e2](https://github.com/ritik4ever/stellar-stream/commit/984f7e25872270c596cae35a9395cee94bba039a))
* Resolve pre-existing test failures across multiple test files ([359309b](https://github.com/ritik4ever/stellar-stream/commit/359309bec52444c9de505769a59ea0d9495fa4c5))
* Resolve TypeScript build errors causing CI failures ([583379c](https://github.com/ritik4ever/stellar-stream/commit/583379c326a57528cb0ef2241b9eb8be30f12b16))
* Restore auth protection for protected routes ([423d4b6](https://github.com/ritik4ever/stellar-stream/commit/423d4b650a39e8e0f1f27a34ec7d1f9ceddc9b43))
* **streams:** Apply asset and q filters with AND logic (bug [#728](https://github.com/ritik4ever/stellar-stream/issues/728)) ([#1256](https://github.com/ritik4ever/stellar-stream/issues/1256)) ([9285717](https://github.com/ritik4ever/stellar-stream/commit/9285717e4b0fa53cb392c4bbc1120534b93655f9))
* Validate Soroban env vars on startup ([b3a3dd3](https://github.com/ritik4ever/stellar-stream/commit/b3a3dd313f63e9c092c0315e5413ef219ceb4d13))
* Validate startAt must be at least 10 seconds in the future ([eb43f15](https://github.com/ritik4ever/stellar-stream/commit/eb43f15877df48f0d5daebcbc76febfc30a6edc3)), closes [#611](https://github.com/ritik4ever/stellar-stream/issues/611)
* **webhooks:** Prune dead-letter queue ([b8db5d1](https://github.com/ritik4ever/stellar-stream/commit/b8db5d1dcd838440d12595a47257fa7d3d8c088f)), closes [#605](https://github.com/ritik4ever/stellar-stream/issues/605)


### Documentation

* **#429:** Add JSDoc to all exported functions in streamStore.ts ([6852954](https://github.com/ritik4ever/stellar-stream/commit/685295481038705b9b6e8b01dc382b7d2e1feec8))
* Add JSDoc docstrings to all undocumented functions across backend and frontend ([1c81d69](https://github.com/ritik4ever/stellar-stream/commit/1c81d698e82bdae5e5b03654efa4a0b25068e2d4))


### Tests

* Add integration test for webhook worker retry and dead-letter flow ([816cad3](https://github.com/ritik4ever/stellar-stream/commit/816cad38f7f05c1bcc7d2485eec65acd5eff6bf8)), closes [#374](https://github.com/ritik4ever/stellar-stream/issues/374)
* Add repeatable verification for webhook monitoring ([#1253](https://github.com/ritik4ever/stellar-stream/issues/1253)) ([0f75e2f](https://github.com/ritik4ever/stellar-stream/commit/0f75e2f705dd4638bd70ed03bec6cbba50e978b3))
* Add streams pagination and filtering integration coverage ([8637c91](https://github.com/ritik4ever/stellar-stream/commit/8637c91e2f4da00ead525ff463b1105a29ba24b9))
* Add supertest integration tests for all auth-protected routes ([#375](https://github.com/ritik4ever/stellar-stream/issues/375)) ([8dca00d](https://github.com/ritik4ever/stellar-stream/commit/8dca00d9126e4e222707e507f0482aaf9bd1d189))
* Add unit tests for indexer circuit breaker state transitions ([#225](https://github.com/ritik4ever/stellar-stream/issues/225)) ([1e15698](https://github.com/ritik4ever/stellar-stream/commit/1e15698e0034c8c1f0bd0a493ac937d093bad9ea))
* Add unit tests for validateEnv/ StreamsTable – cancel/ RecipientDashboard / CreateStreamForm ([06a8d6e](https://github.com/ritik4ever/stellar-stream/commit/06a8d6e137b9bb69e77b1cbd66747f4947e81b78))
* Add weekly autocannon load test workflow (Resolves [#426](https://github.com/ritik4ever/stellar-stream/issues/426)) ([f31a920](https://github.com/ritik4ever/stellar-stream/commit/f31a920914b98bbbbff6c74c580880a543d683a3))
* **backend:** Add progress verification to sender streams integration test ([#240](https://github.com/ritik4ever/stellar-stream/issues/240)) ([28674cb](https://github.com/ritik4ever/stellar-stream/commit/28674cbf945606c8ba7e0a4ff5ebc54b471a80b2))
* **backend:** Verify environment variable overrides for assets allowlist ([#238](https://github.com/ritik4ever/stellar-stream/issues/238)) ([6975216](https://github.com/ritik4ever/stellar-stream/commit/6975216faecc2862846cfb1d347df1e1d166c78b))
* **deps:** Add repeatable dependency verification ([#1247](https://github.com/ritik4ever/stellar-stream/issues/1247)) ([552b6ab](https://github.com/ritik4ever/stellar-stream/commit/552b6abdf37852c159f152d34706426a1e4f2d54))
* Fix pino-pretty transport in test environment ([c36ddef](https://github.com/ritik4ever/stellar-stream/commit/c36ddefa07ff51ac4edc1cab751a8cd094eb3e20))
* **frontend:** Add SenderDashboard test coverage and resolve merge conflicts ([2e9cd1a](https://github.com/ritik4ever/stellar-stream/commit/2e9cd1a0abcb7e89e5788b6f7ac111b2d1b04f23))
* **indexer:** Add gap-fill tests for restart recovery ([c26c428](https://github.com/ritik4ever/stellar-stream/commit/c26c428a027839ae73a1ccdfefd9fe4dd78dedc8))
* **indexer:** Validate monitoring scenarios in clean environment ([#1267](https://github.com/ritik4ever/stellar-stream/issues/1267)) ([309fc09](https://github.com/ritik4ever/stellar-stream/commit/309fc09314ccc788819e968010d9aaea178ab647))
* **streamStore:** Add unit tests for getStreamById and handle archived streams ([#313](https://github.com/ritik4ever/stellar-stream/issues/313)) ([f35c91a](https://github.com/ritik4ever/stellar-stream/commit/f35c91ab188cd4179bef1dc29904f868356a380d))


### Build System

* **deps:** Bump the all-dependencies group in /backend with 22 updates ([#1257](https://github.com/ritik4ever/stellar-stream/issues/1257)) ([c73c348](https://github.com/ritik4ever/stellar-stream/commit/c73c348845e3cb14d06395515e67a1be2ccbfdbc))


### Chores

* **eslint:** Add flat config with typescript and react rules, fix core compilation bugs ([11476ba](https://github.com/ritik4ever/stellar-stream/commit/11476ba6c54080f9d2dc10c278f1159c559d1b78))
