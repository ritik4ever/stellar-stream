# 1.0.0 (2026-04-28)


### Bug Fixes

* Add integration tests for auth challenge-verify-token flow ([#231](https://github.com/godamongstmen897/stellar-stream/issues/231)) ([a75883d](https://github.com/godamongstmen897/stellar-stream/commit/a75883d7d311caf21f09b66ab4beebb14e365c14))
* Add integration tests for recipient streams validation ([#234](https://github.com/godamongstmen897/stellar-stream/issues/234)) ([e5475f0](https://github.com/godamongstmen897/stellar-stream/commit/e5475f008f816a66ba9645d9289fcda79d1b1b5c))
* Add unit tests for webhook triggerWebhook and dead letter handling ([#222](https://github.com/godamongstmen897/stellar-stream/issues/222)) ([a234a41](https://github.com/godamongstmen897/stellar-stream/commit/a234a410aa66b7475ff63b703dca65e4e15959e5))
* Add unit tests for webhookWorker retry backoff and dead letter promotion ([#223](https://github.com/godamongstmen897/stellar-stream/issues/223)) ([a3e772e](https://github.com/godamongstmen897/stellar-stream/commit/a3e772efd1ddf6bcbf51ef6aa8c280b2ddf56f9b))
* **backend:** update tsconfig to resolve vercel type errors ([9492800](https://github.com/godamongstmen897/stellar-stream/commit/9492800b91f06a0c13905e83ecded4adbc59f03f))
* **contracts:** cancel should refund unvested portion only, not total minus claimed ([46470fb](https://github.com/godamongstmen897/stellar-stream/commit/46470fbb26c587d9022ff511ac49233c9bcdaf3f))
* convert postcss.config.js to CommonJS to fix CI build ([cfe651a](https://github.com/godamongstmen897/stellar-stream/commit/cfe651a748c5c66e0362143481cf7c5c4d63dcd4))
* correct cancel logic for edge cases and expand test coverage ([b5dadb2](https://github.com/godamongstmen897/stellar-stream/commit/b5dadb2f8b537a5434f73c2895a37b7782ea49f2))
* Ensure atomic stream state updates and event recording using database transactions, and correct oldStartAt capture in `updateStreamStartAt`. ([ebd07ed](https://github.com/godamongstmen897/stellar-stream/commit/ebd07ed1a40886cb5435fcfb861e683729ecd70f))
* **frontend:** add vite-env.d.ts to resolve TypeScript error on import.meta.env ([1da596c](https://github.com/godamongstmen897/stellar-stream/commit/1da596cdd69eb04fb8ef2f6272bdae474cc95e2e))
* **frontend:** resolve TS error with vite-env.d.ts ([4b128e7](https://github.com/godamongstmen897/stellar-stream/commit/4b128e7ba32ddb54f39fb0215991366add752fec))
* **indexer:** complete soroban RPC circuit breaker and resolve compiler errors ([79b8004](https://github.com/godamongstmen897/stellar-stream/commit/79b80042bc69c497e335482a99e10eb51d0940d5))
* remove package.json ([d4a7400](https://github.com/godamongstmen897/stellar-stream/commit/d4a74001acdbfac3b09aedab0abe7f23ed8ec422))
* repair upstream merge damage to frontend and backend ([6ce1f14](https://github.com/godamongstmen897/stellar-stream/commit/6ce1f14cd15f341105a75839b031e167c65c3537))
* resolve merge conflicts and complete asset whitelist feature ([aa1b3c6](https://github.com/godamongstmen897/stellar-stream/commit/aa1b3c6e7bf4efcc987d6416049fa3feb3603ddd))
* restore frontend package-lock ([8e088eb](https://github.com/godamongstmen897/stellar-stream/commit/8e088ebd6c70e3dec8f780785a54808de7bfc073))
* update streamStore with Soroban version and resolve index.ts conflict ([1d6acb3](https://github.com/godamongstmen897/stellar-stream/commit/1d6acb3d8bf33fac9cfe513bdc9182d06c689475))


### Features

* **#151:** Validate query params on GET /api/streams/export.csv ([6fd9097](https://github.com/godamongstmen897/stellar-stream/commit/6fd90972ac96a0aaee2d009ed3249b476f10f42e)), closes [#151](https://github.com/godamongstmen897/stellar-stream/issues/151)
* **#155:** Add Stellar public key validation using StrKey.isValidEd25519PublicKey ([34c341f](https://github.com/godamongstmen897/stellar-stream/commit/34c341f296e8cb07c30e7cd14a2e25ceb87f83c7)), closes [#155](https://github.com/godamongstmen897/stellar-stream/issues/155)
* **#158:** Implement webhook retry queue with dead-letter storage ([e2796ad](https://github.com/godamongstmen897/stellar-stream/commit/e2796adfcd5c2c9aee2a386da4f97ca0e340add1)), closes [#158](https://github.com/godamongstmen897/stellar-stream/issues/158)
* **#161,#167,#168,#169:** add frontend hooks for toasts, websocket updates, and typed API errors ([7ec8b10](https://github.com/godamongstmen897/stellar-stream/commit/7ec8b106dbe93e1454aa7d27a2bd945ec6bdaf65)), closes [#161](https://github.com/godamongstmen897/stellar-stream/issues/161) [#167](https://github.com/godamongstmen897/stellar-stream/issues/167) [#168](https://github.com/godamongstmen897/stellar-stream/issues/168) [#169](https://github.com/godamongstmen897/stellar-stream/issues/169)
* add /api/allowed-assets endpoint and clean up index.ts ([95f9d29](https://github.com/godamongstmen897/stellar-stream/commit/95f9d298be877293479ab646451c994855cecb57))
* add asset whitelist config, backend validation & dynamic frontend dropdown ([#18](https://github.com/godamongstmen897/stellar-stream/issues/18)) ([a1fd599](https://github.com/godamongstmen897/stellar-stream/commit/a1fd59945d18ed134692034ea62e049e175e6b58))
* add background job to refresh stream statuses ([110f128](https://github.com/godamongstmen897/stellar-stream/commit/110f128a79353aa8ac17791812e9b8c8407659a2))
* add better-sqlite3 dependency for sqlite persistence ([0c478da](https://github.com/godamongstmen897/stellar-stream/commit/0c478da83dbd8bbd108ebf1403baad921b1ee5ff))
* add bulk filter presets for operations teams ([#51](https://github.com/godamongstmen897/stellar-stream/issues/51)) ([dea6718](https://github.com/godamongstmen897/stellar-stream/commit/dea67182d1ab46bc100533269576dc18fc7d3478))
* add comprehensive backend tests for auth-protected endpoints ([#76](https://github.com/godamongstmen897/stellar-stream/issues/76)) ([e96fa23](https://github.com/godamongstmen897/stellar-stream/commit/e96fa23ed406f2cf05dbc5e8100de88898bb094f))
* add contract client generation workflow for frontend ([#81](https://github.com/godamongstmen897/stellar-stream/issues/81)) ([04d9e41](https://github.com/godamongstmen897/stellar-stream/commit/04d9e419efa78a67e75bb934c330051771798247))
* add contract events for stream lifecycle operations ([2316865](https://github.com/godamongstmen897/stellar-stream/commit/231686566869206cf8374b6684daaaf9438a614d))
* add event-type filters to StreamTimeline ([679f0c1](https://github.com/godamongstmen897/stellar-stream/commit/679f0c11e1dab0df47d0d6f5af3669d40283f357))
* add Freighter wallet connect/disconnect ([#2](https://github.com/godamongstmen897/stellar-stream/issues/2)) ([4244cc4](https://github.com/godamongstmen897/stellar-stream/commit/4244cc47e0543a9cd4ec7790012ea784a5ceeb40))
* add GET /api/events for global event history ([#63](https://github.com/godamongstmen897/stellar-stream/issues/63)) ([a6d0b4b](https://github.com/godamongstmen897/stellar-stream/commit/a6d0b4bbab862211626d1211413fa61f47c13307))
* add global recent activity feed ([e136740](https://github.com/godamongstmen897/stellar-stream/commit/e13674053d8e769bc59e194bcc2b63992f3f3512))
* add JWT hardening, stream pause/resume, and contract test coverage improvements ([3957d9c](https://github.com/godamongstmen897/stellar-stream/commit/3957d9c57146dc3fb19dacdee6c163188fd60b94))
* add optional webhook signing ([77e845a](https://github.com/godamongstmen897/stellar-stream/commit/77e845a9b47b7768345d4d0010711cd6103fc6bd))
* Add pagination to getStreamHistory API endpoint ([07aeb6a](https://github.com/godamongstmen897/stellar-stream/commit/07aeb6a160f1d8bfd9a8cf91140c94ddee72cbf3)), closes [#143](https://github.com/godamongstmen897/stellar-stream/issues/143)
* add responsive chart section and empty state styles ([6022379](https://github.com/godamongstmen897/stellar-stream/commit/60223798b1bfe98abfbf655102cb70d7b038604b))
* add retry queue for webhook delivery failures ([#70](https://github.com/godamongstmen897/stellar-stream/issues/70)) ([1e9450e](https://github.com/godamongstmen897/stellar-stream/commit/1e9450ead8144c5fe9e459bcfc4b093f0aef3a02))
* add sender dashboard view with filtering and metrics ([1efd2b5](https://github.com/godamongstmen897/stellar-stream/commit/1efd2b526b3ba23269f255be7a171b95725a29cc))
* add shared zod validation for backend and frontend ([c6417a4](https://github.com/godamongstmen897/stellar-stream/commit/c6417a43aafb16ecc990c65da0b396a78dcdca32))
* add sqlite database initialization and migration layer ([281fe72](https://github.com/godamongstmen897/stellar-stream/commit/281fe72bd46d736790edb43e5c053fbae4eebcda))
* add startup config validation for Soroban environment ([#72](https://github.com/godamongstmen897/stellar-stream/issues/72)) ([dd3c6ef](https://github.com/godamongstmen897/stellar-stream/commit/dd3c6efb19aa12e89cf63ef9493d22f34162f212))
* add stream health badges in table ([#52](https://github.com/godamongstmen897/stellar-stream/issues/52)) ([b1f35f0](https://github.com/godamongstmen897/stellar-stream/commit/b1f35f0aecc008c8de7231bdda6c63ae77986caa))
* add StreamMetricsChart component with area chart and empty state ([6805449](https://github.com/godamongstmen897/stellar-stream/commit/68054494916d19a019d0d8d8335db8dd5bf53c7e))
* Add Swagger API documentation for backend routes ([9219d71](https://github.com/godamongstmen897/stellar-stream/commit/9219d710d3125e60dabec511397693c52cb559d1))
* add useFormValidation hook and update CreateStreamForm with whitelist dropdown ([62b9dca](https://github.com/godamongstmen897/stellar-stream/commit/62b9dca5898eea5b0025823c8f41039f7c251a20))
* add useMetricsHistory hook to track metrics snapshots over time ([926610f](https://github.com/godamongstmen897/stellar-stream/commit/926610f5e6b8dd6b5f04dc6a04f9e9c89ef8c8e2))
* **backend:** add request ID and structured logging middleware ([12921ff](https://github.com/godamongstmen897/stellar-stream/commit/12921ffb7ec39cef0b62c0761a71855f526df6e3))
* batch syncStreams, status refresh cron, refresh token, claim flow ([#136](https://github.com/godamongstmen897/stellar-stream/issues/136) [#138](https://github.com/godamongstmen897/stellar-stream/issues/138) [#140](https://github.com/godamongstmen897/stellar-stream/issues/140) [#49](https://github.com/godamongstmen897/stellar-stream/issues/49)) ([7bff88e](https://github.com/godamongstmen897/stellar-stream/commit/7bff88e6c06388bb60cc4121aaaec3675cb52bf1))
* **contract:** add stream metadata and compliance clawback ([#119](https://github.com/godamongstmen897/stellar-stream/issues/119) [#121](https://github.com/godamongstmen897/stellar-stream/issues/121)) ([e786bf7](https://github.com/godamongstmen897/stellar-stream/commit/e786bf7fa1c29cbc4ce98726fa37b925b00cfe86))
* expose asset allowlist endpoint ([d6efb5d](https://github.com/godamongstmen897/stellar-stream/commit/d6efb5d2f393f6dc366c4223c6133e7f39e69551))
* form draft autosave for stream creation ([#59](https://github.com/godamongstmen897/stellar-stream/issues/59)) ([4f6b4af](https://github.com/godamongstmen897/stellar-stream/commit/4f6b4af8f697ca32cddadf09c509a5a4ae2d8d47))
* implement asset whitelist - env config, backend validation, dynamic endpoint & frontend dropdown ([#18](https://github.com/godamongstmen897/stellar-stream/issues/18)) ([30fe446](https://github.com/godamongstmen897/stellar-stream/commit/30fe446801e8fc2fad09153979d8043287c6dbe1))
* implement initial backend API and frontend UI for Stellar Stream application. ([57e121e](https://github.com/godamongstmen897/stellar-stream/commit/57e121e464376e6a76a3cd7601f17d0163926243))
* implement query parsing and pagination for streams API ([44c5b20](https://github.com/godamongstmen897/stellar-stream/commit/44c5b203a1b2af296bc8fc76e983759292926475))
* Implement SEP-10 Auth ([b6c7fcc](https://github.com/godamongstmen897/stellar-stream/commit/b6c7fcc0168ecd17b4d71f319a2a3b46e7dc8596))
* implement stream event history system ([096e1af](https://github.com/godamongstmen897/stellar-stream/commit/096e1af2d4008bc98204a7fe653b6a8e96462e9f))
* Implement stream management with a new frontend table, backend API, validation, Swagger documentation, and tests. ([58c5355](https://github.com/godamongstmen897/stellar-stream/commit/58c53554e66c87e05ab23db166112dfd367898b6))
* implement webhook notifications with exponential backoff ([8bacaf1](https://github.com/godamongstmen897/stellar-stream/commit/8bacaf1a120dcd4e493442a2a513abfd1d254d80))
* integrate request logging middleware at server startup ([b2cd621](https://github.com/godamongstmen897/stellar-stream/commit/b2cd621f9477bde390d153cedef132642144c790))
* Integrate Soroban contract for stream management and add backend initialization for RPC and stream syncing. ([eed910b](https://github.com/godamongstmen897/stellar-stream/commit/eed910b2e3ba4a36cc19fae3a7930c5743cc20dc))
* integrate Soroban token client for real token transfer on claim ([9419d33](https://github.com/godamongstmen897/stellar-stream/commit/9419d337c1f8756a52c5c79903b687f75980f00a))
* integrate stream metrics chart and history tracking into dashboard ([f117835](https://github.com/godamongstmen897/stellar-stream/commit/f11783527a088dbbdc5901bcc0cca6b0349b005d))
* keyboard-accessible modal flow for start-time editing ([#57](https://github.com/godamongstmen897/stellar-stream/issues/57)) ([1cbf023](https://github.com/godamongstmen897/stellar-stream/commit/1cbf02340fa775a7180659b7f27c28dbbb97bb99))
* persist dashboard filters and view state in URL with stream timeline expand ([3a8c5cb](https://github.com/godamongstmen897/stellar-stream/commit/3a8c5cb4d77e39e4df64d22d1b14a82033583f42))
* persist indexer cursor in SQLite to handle restarts ([#68](https://github.com/godamongstmen897/stellar-stream/issues/68)) ([a9fd0d3](https://github.com/godamongstmen897/stellar-stream/commit/a9fd0d32340be86f7edc0d4de39bf64cfe98557d))
* replace in-memory stream store with sqlite persistence ([df825ad](https://github.com/godamongstmen897/stellar-stream/commit/df825ad62a678b095fdd2cd1401f47602dcbffb0))
* setup docker compose for local development ([e783c0d](https://github.com/godamongstmen897/stellar-stream/commit/e783c0dc8fcb5b304bb98ca410000739fc82a8d6))
* standardize request ID in all error responses ([550301c](https://github.com/godamongstmen897/stellar-stream/commit/550301c9a47c6eb06f8c75812ff9b006c1a9b715)), closes [#154](https://github.com/godamongstmen897/stellar-stream/issues/154)
* Standardize request ID in all error responses ([07a54b5](https://github.com/godamongstmen897/stellar-stream/commit/07a54b51cbff4ae399b6dbc259b2a643d740d487)), closes [#154](https://github.com/godamongstmen897/stellar-stream/issues/154)
* update test.rs ([5cc4d85](https://github.com/godamongstmen897/stellar-stream/commit/5cc4d85ecbdaa51874617e1e60cd3ca3afd486fd))
* **wave4:** add reliability, performance, and data accuracy improvements ([1bf095a](https://github.com/godamongstmen897/stellar-stream/commit/1bf095add9a803b15fe70c5019ce73d703abda5a)), closes [#133](https://github.com/godamongstmen897/stellar-stream/issues/133) [#132](https://github.com/godamongstmen897/stellar-stream/issues/132) [#134](https://github.com/godamongstmen897/stellar-stream/issues/134) [#137](https://github.com/godamongstmen897/stellar-stream/issues/137) [#133](https://github.com/godamongstmen897/stellar-stream/issues/133) [#132](https://github.com/godamongstmen897/stellar-stream/issues/132) [#134](https://github.com/godamongstmen897/stellar-stream/issues/134) [#137](https://github.com/godamongstmen897/stellar-stream/issues/137)
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project currently tracks history by milestone date.

## [1.1.0](https://github.com/ritik4ever/stellar-stream/compare/v1.0.0...v1.1.0) (2026-09-30)


### Features

* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([44f7b8b](https://github.com/ritik4ever/stellar-stream/commit/44f7b8bdc1676b92f5d81e1a25c9ef6258d24ec9))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([d8d4b4a](https://github.com/ritik4ever/stellar-stream/commit/d8d4b4a03b549b47c29cbd68d2803976dc22dd06))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([f1c9bcc](https://github.com/ritik4ever/stellar-stream/commit/f1c9bcc5daf38f0c661b98d886a65f6c2df4a644))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([77333bf](https://github.com/ritik4ever/stellar-stream/commit/77333bfac0a5e63c93fe0bc01d7cf5b71e4720df))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([d830084](https://github.com/ritik4ever/stellar-stream/commit/d830084489698f4e35666dfe67f26fed67fe906f))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([68459bc](https://github.com/ritik4ever/stellar-stream/commit/68459bc476bdc2537716c7653f31cdf12e8a481c))
* [FEATURE] Add backend unit test coverage to 80%+ ([#784](https://github.com/ritik4ever/stellar-stream/issues/784)) ([5fefa15](https://github.com/ritik4ever/stellar-stream/commit/5fefa1579a5219dc526ac1bd177a1ebe314808fe))
* [FEATURE] Add dark/light theme toggle with system preference ([#753](https://github.com/ritik4ever/stellar-stream/issues/753)) ([#1288](https://github.com/ritik4ever/stellar-stream/issues/1288)) ([63e2d94](https://github.com/ritik4ever/stellar-stream/commit/63e2d94ce5c1d5ceb51eacd5be01f84de4604f7b))
* **#420:** Add docker-compose.override.yml for local dev with hot-reload ([7312383](https://github.com/ritik4ever/stellar-stream/commit/7312383f655beaa28d6f305c3a6aab69bd28015f))
* **#440:** Add ADMIN_API_KEY validation strength check on startup ([8eb9e45](https://github.com/ritik4ever/stellar-stream/commit/8eb9e45023ceb21029fb59e0d94866d58e5cb54f))
* **#444:** Add rate limit tightening for mutation endpoints ([900e833](https://github.com/ritik4ever/stellar-stream/commit/900e8330bd7972b3fa5e9893b4e242c21321bb2f))
* **#446:** Add Redis cache layer for production multi-instance deployments ([33809d5](https://github.com/ritik4ever/stellar-stream/commit/33809d5902671577000146d13cf8cc53c92041e4))
* **#453:** Add assetCode filter to GET /api/streams ([5c0fe87](https://github.com/ritik4ever/stellar-stream/commit/5c0fe87103fde45204db2fe532d258109f5eb3b8))
* **#456:** Add stream_completed event recording when vested amount reaches total ([ae7a4b7](https://github.com/ritik4ever/stellar-stream/commit/ae7a4b76b70d18b1214068dce0007d1d259541d3))
* Add ALLOWED_ORIGINS env var for production CORS allowlist ([6fbf6e4](https://github.com/ritik4ever/stellar-stream/commit/6fbf6e4990657330fe99a12935d216c20edb83ec)), closes [#366](https://github.com/ritik4ever/stellar-stream/issues/366)
* Add bundle visualizer and enhance contract CI ([84cd3d4](https://github.com/ritik4ever/stellar-stream/commit/84cd3d4e6b97cd7b0422ea9f58a64995e3dace85))
* Add CODE_OF_CONDUCT.md/ Add CONTRACT_BINDINGS.md/ Add semantic-release/  Add SECURITY.md ([e683f94](https://github.com/ritik4ever/stellar-stream/commit/e683f9410d992506fa7d2ad276a67acf6b265de8))
* Add Content-Type enforcement middleware for POST/PATCH routes ([#367](https://github.com/ritik4ever/stellar-stream/issues/367)) ([bb99707](https://github.com/ritik4ever/stellar-stream/commit/bb99707a6e1a9d3c11a7fcd8be552b168c9b2715))
* Add exponential backoff retry for Soroban transaction submission ([8b564bd](https://github.com/ritik4ever/stellar-stream/commit/8b564bd223de12263065b8026d347cdc94e3e62b)), closes [#353](https://github.com/ritik4ever/stellar-stream/issues/353)
* Add FAQ.md/Add Mermaid/Add RUNBOOK.md/Add DEPLOYMENT.md ([07eba1e](https://github.com/ritik4ever/stellar-stream/commit/07eba1ecb4bd5b14e9ed83f8247293a8b97a200b))
* Add FTS5 full-text search endpoint ([#348](https://github.com/ritik4ever/stellar-stream/issues/348)) ([d8491bf](https://github.com/ritik4ever/stellar-stream/commit/d8491bf07d4878f3b491d72507f18fdb0044cb91))
* Add GET /api/docs/openapi.json endpoint and Swagger UI link in README ([34bdad6](https://github.com/ritik4ever/stellar-stream/commit/34bdad6eb8e43a978468d5f0d011f28e564b24bb)), closes [#376](https://github.com/ritik4ever/stellar-stream/issues/376)
* Add GET /api/streams/sender/:address and /recipient/:address endpoints ([e4ad078](https://github.com/ritik4ever/stellar-stream/commit/e4ad07883c1dd437c953a713a28b504cf41b44ad))
* Add get_stream_count view and expose onChainStreamCount via /api/stats ([45e7c3f](https://github.com/ritik4ever/stellar-stream/commit/45e7c3fc5431b0600f8cb9f575af03703b03d752))
* Add label filtering and sorting to IssueBacklog ([#461](https://github.com/ritik4ever/stellar-stream/issues/461)) ([9012a84](https://github.com/ritik4ever/stellar-stream/commit/9012a8470cb0813792c09534ba9f4c4ddcbfe520))
* Add live stream progress bar with per-second countdown timer ([252a3c1](https://github.com/ritik4ever/stellar-stream/commit/252a3c1f0aa578d3d67ff20dd645299425a1cb42))
* Add minAmount and maxAmount range filters to GET /api/streams ([56569cf](https://github.com/ritik4ever/stellar-stream/commit/56569cf30d0ff916ddd7517c2bed746cfa4b35fa))
* Add npm audit and cargo audit to CI security gate ([#419](https://github.com/ritik4ever/stellar-stream/issues/419)) ([d94b455](https://github.com/ritik4ever/stellar-stream/commit/d94b455a7d407aa0bd0e27c643dd77950177c809))
* Add npm audit and cargo audit to CI security gate ([#419](https://github.com/ritik4ever/stellar-stream/issues/419)) ([62049d9](https://github.com/ritik4ever/stellar-stream/commit/62049d943063435419c3ec95bfa9cf9f65991b5c))
* Add pagination, streamId, and since filters to GET /api/events ([a59c26e](https://github.com/ritik4ever/stellar-stream/commit/a59c26e8f17d45ec079b48606c5ef6e9a56dcd63)), closes [#380](https://github.com/ritik4ever/stellar-stream/issues/380)
* Add POST /api/streams/:id/mark-complete manual completion endpoint ([03091e4](https://github.com/ritik4ever/stellar-stream/commit/03091e44a7af13baebddd27883f2e89a272260ef)), closes [#369](https://github.com/ritik4ever/stellar-stream/issues/369)
* Add POST /api/streams/bulk-cancel endpoint ([#381](https://github.com/ritik4ever/stellar-stream/issues/381)) ([a6a21ca](https://github.com/ritik4ever/stellar-stream/commit/a6a21cacbdcc1a5d877941da21b0502249520364))
* Add request tracing with correlation ID to all log lines ([f27613c](https://github.com/ritik4ever/stellar-stream/commit/f27613c7e18d4810bf1191fe325c244afd1cce4e))
* Add RUNBOOK playbooks and release-please CHANGELOG automation ([7e5c3ae](https://github.com/ritik4ever/stellar-stream/commit/7e5c3aeb1f7610cbc4b0b0c0eb90e4fef2dde356)), closes [#792](https://github.com/ritik4ever/stellar-stream/issues/792) [#805](https://github.com/ritik4ever/stellar-stream/issues/805)
* Add SAC validation, stream metadata, and indexer events for paused/resumed/transfer ([70724e5](https://github.com/ritik4ever/stellar-stream/commit/70724e51f47974bbf83bf15b23c9cce4abc21959))
* Add scripts/seed-streams.js for deterministic demo data seeding ([c140537](https://github.com/ritik4ever/stellar-stream/commit/c140537fb5833b65d19aaa1ff81fb19a2fed14b0))
* Add sender streams API, on-chain queries, and pause/resume ([fb0f8e0](https://github.com/ritik4ever/stellar-stream/commit/fb0f8e0ff12f6b92e3a988442eb2a49b48508ea0))
* Add SQLite pragmas ([#360](https://github.com/ritik4ever/stellar-stream/issues/360)) and archive job cron ([#350](https://github.com/ritik4ever/stellar-stream/issues/350)) ([2b985ef](https://github.com/ritik4ever/stellar-stream/commit/2b985efc28440edd56141da5772ed2221374b9a9))
* Add Storybook for all reusable frontend components [[#406](https://github.com/ritik4ever/stellar-stream/issues/406)] ([fb5f5f8](https://github.com/ritik4ever/stellar-stream/commit/fb5f5f8e5e861f7ef1538bf5bedd0c52d1d8c2cb))
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
* **ci:** Add Playwright E2E workflow with Docker Compose stack ([f7a5637](https://github.com/ritik4ever/stellar-stream/commit/f7a5637b1f516d2d200845eaab49de17c9b9e583))
* **contracts:** Add DAO governance scaffold ([#695](https://github.com/ritik4ever/stellar-stream/issues/695)) ([015b5b5](https://github.com/ritik4ever/stellar-stream/commit/015b5b5495880077c171b9b2b3e8ef2d1d9a869e))
* **contracts:** Add multi-token allowlist support ([#593](https://github.com/ritik4ever/stellar-stream/issues/593)) ([2aa9fe6](https://github.com/ritik4ever/stellar-stream/commit/2aa9fe6d39064a5be91a944e0c30e75847dd6315))
* **contracts:** Add structured event schema with actor+timestamp ([a3f582c](https://github.com/ritik4ever/stellar-stream/commit/a3f582cf5e2b01001c5ffa7ae2e09a8606b70908))
* **contracts:** Document upgrade compatibility guarantees ([#1292](https://github.com/ritik4ever/stellar-stream/issues/1292)) ([c5fac56](https://github.com/ritik4ever/stellar-stream/commit/c5fac56f51f819207e193d7dafd77d32e66d0300))
* **contracts:** Document upgrade compatibility guarantees ([#1293](https://github.com/ritik4ever/stellar-stream/issues/1293)) ([6c64796](https://github.com/ritik4ever/stellar-stream/commit/6c64796c806e5c3b1bef7b20ca77eae6d72274b1))
* **contracts:** Rate-limit claims with min_claim_interval_seconds ([#681](https://github.com/ritik4ever/stellar-stream/issues/681)) ([5085521](https://github.com/ritik4ever/stellar-stream/commit/5085521aac35606fb8004da78fdf18466fe2f0d0))
* **database:** Migrate SQLite schema to support optional PostgreSQL backend ([27eecb0](https://github.com/ritik4ever/stellar-stream/commit/27eecb0b8643a140c467ae70b547471d2b4a86a5))
* Enhance rate limiting handlers to support next function ([488464b](https://github.com/ritik4ever/stellar-stream/commit/488464b396ef96a8cd759ced495b005f76624776))
* Expose SQLite restore schema-check outcome signal ([#1261](https://github.com/ritik4ever/stellar-stream/issues/1261)) ([f30fb38](https://github.com/ritik4ever/stellar-stream/commit/f30fb38a76bba8f71a231ebaaa0f53460e1e6faf))
* **frontend:** Add stale-while-revalidate caching to API client ([7e8d263](https://github.com/ritik4ever/stellar-stream/commit/7e8d26399563176be99bab8c7d742c9714b10ffb))
* **frontend:** Wire Soroban claim tx hash to backend via reconcile endpoint ([#322](https://github.com/ritik4ever/stellar-stream/issues/322)) ([160e08a](https://github.com/ritik4ever/stellar-stream/commit/160e08a4ecda4cad376501869148710781ee6f97))
* Generate and commit TypeScript contract bindings from ABI ([7d52e10](https://github.com/ritik4ever/stellar-stream/commit/7d52e10f4ed2adce57ea469683540ed3e3fdeaff))
* Implement cursor-based pagination for global events and add integration tests ([#239](https://github.com/ritik4ever/stellar-stream/issues/239), [#240](https://github.com/ritik4ever/stellar-stream/issues/240), [#238](https://github.com/ritik4ever/stellar-stream/issues/238)) ([980e7af](https://github.com/ritik4ever/stellar-stream/commit/980e7afeefb6057a572f64f197b62275505b36f5))
* Implement draft recovery banner with autosave functionality ([4abf71c](https://github.com/ritik4ever/stellar-stream/commit/4abf71c631f80ff9b5485615df8f039204f49c78))
* Implement four open source contributions ([1edd1c2](https://github.com/ritik4ever/stellar-stream/commit/1edd1c265994d3eb2507970e37d72f06b3ed7137))
* Implement security and infrastructure improvements ([ef3a2b6](https://github.com/ritik4ever/stellar-stream/commit/ef3a2b6efc4dad09cc053266039b1fd47631bb95))
* Implement SenderDashboard with stream analytics and activity feed ([9275174](https://github.com/ritik4ever/stellar-stream/commit/927517465e6d0cf71bd827a1d7676c347adc51f0)), closes [#392](https://github.com/ritik4ever/stellar-stream/issues/392)
* **indexer:** Expose monitoring outcome signal for RPC rate limit / disconnection ([#1227](https://github.com/ritik4ever/stellar-stream/issues/1227)) ([#1262](https://github.com/ritik4ever/stellar-stream/issues/1262)) ([4e21648](https://github.com/ritik4ever/stellar-stream/commit/4e21648238c04a9a89e2f08b26620dbb9d734a9c))
* **indexer:** Replace polling with Stellar RPC event fetching ([dad123a](https://github.com/ritik4ever/stellar-stream/commit/dad123a8e567aec169888adb761f173c969afcfe))
* **observability:** Record webhook monitoring outcomes ([#1252](https://github.com/ritik4ever/stellar-stream/issues/1252)) ([22ab709](https://github.com/ritik4ever/stellar-stream/commit/22ab709c40860e6c6db72ece5d0dae351d7db7e5))
* **operations:** Record SQLite backup interrupted outcomes and document in runbook (SSB-2026-274) ([#1270](https://github.com/ritik4ever/stellar-stream/issues/1270)) ([9ad54f9](https://github.com/ritik4ever/stellar-stream/commit/9ad54f9771da9a497b8a1c8b263ce085d537ffb7))
* **ops:** Handle unhealthy backend during Docker Compose startup ([df6ef8c](https://github.com/ritik4ever/stellar-stream/commit/df6ef8c2335fe08bb25bc1b420e16b871d69eb0d))
* **ops:** Network-aware deployment config with fail-fast recovery (SSB-2026-262) ([#1274](https://github.com/ritik4ever/stellar-stream/issues/1274)) ([07cfd1c](https://github.com/ritik4ever/stellar-stream/commit/07cfd1cd469e33168fd56ef3ae592de2978c3351))
* **ops:** Record deployment configuration outcomes ([#1207](https://github.com/ritik4ever/stellar-stream/issues/1207)) ([#1276](https://github.com/ritik4ever/stellar-stream/issues/1276)) ([7a73c15](https://github.com/ritik4ever/stellar-stream/commit/7a73c15237bb23403a7bbd33e942fde466a20dc1))
* **ops:** Record fresh startup and verify SQLite backups ([#1273](https://github.com/ritik4ever/stellar-stream/issues/1273)) ([36d4fa1](https://github.com/ritik4ever/stellar-stream/commit/36d4fa1c3a577bf411097d4a753263f988ff0be6))
* **ops:** Validate monitoring config and document webhook recovery ([#1269](https://github.com/ritik4ever/stellar-stream/issues/1269)) ([9c3195a](https://github.com/ritik4ever/stellar-stream/commit/9c3195ae9a55badf0979be244514ab8dcec17712))
* **ops:** Validate secrets rotation in clean environment ([#1263](https://github.com/ritik4ever/stellar-stream/issues/1263)) ([c1ad219](https://github.com/ritik4ever/stellar-stream/commit/c1ad2198d62b90164b1241319d736063a9594bef)), closes [#1209](https://github.com/ritik4ever/stellar-stream/issues/1209)
* Resolve issues [#328](https://github.com/ritik4ever/stellar-stream/issues/328), [#329](https://github.com/ritik4ever/stellar-stream/issues/329), [#331](https://github.com/ritik4ever/stellar-stream/issues/331), [#334](https://github.com/ritik4ever/stellar-stream/issues/334) — cliff support, split stream UI, metadata display, lifecycle test ([66a9ef3](https://github.com/ritik4ever/stellar-stream/commit/66a9ef32751a946ac6f5e0dc6bde48abea1abc20))
* Skeleton rows, React.memo, reduced-motion, EditStartTimeModal validation ([0b33817](https://github.com/ritik4ever/stellar-stream/commit/0b338175902bd675deaf3eef65578905c02642ae)), closes [#396](https://github.com/ritik4ever/stellar-stream/issues/396) [#397](https://github.com/ritik4ever/stellar-stream/issues/397) [#403](https://github.com/ritik4ever/stellar-stream/issues/403) [#405](https://github.com/ritik4ever/stellar-stream/issues/405)
* Support streaming native XLM alongside SEP-41 tokens ([#120](https://github.com/ritik4ever/stellar-stream/issues/120)) ([a96ec54](https://github.com/ritik4ever/stellar-stream/commit/a96ec5436f62ff58a16d1b5bb25f0cbacff528bc))


### Bug Fixes

* [CONTRACT] Specify edge behavior for Contract upgrade compat ([#1179](https://github.com/ritik4ever/stellar-stream/issues/1179)) ([#1281](https://github.com/ritik4ever/stellar-stream/issues/1281)) ([70bd3f9](https://github.com/ritik4ever/stellar-stream/commit/70bd3f9e9413e1daf0fbb587889a53596da9b593))
* **#711:** Enforce sender ownership on cancel endpoint and fix pre-existing blockers ([174c1d6](https://github.com/ritik4ever/stellar-stream/commit/174c1d6374ab130013c5054b39c0b86d11cad15b))
* **364,399:** Gzip middleware confirmed + StreamDetailDrawer Stellar Expert tx links ([a2cd8b8](https://github.com/ritik4ever/stellar-stream/commit/a2cd8b8cc9ed59bac127ed9a54b6dff3823f9f74))
* Add completed to eventType enum and reject blank streamId in events schema ([dc32371](https://github.com/ritik4ever/stellar-stream/commit/dc32371c1b736338c0a6506f20424aa98efc5b0a))
* Add completed to eventType enum and reject blank streamId in events schema ([a80f76d](https://github.com/ritik4ever/stellar-stream/commit/a80f76dc217255c18fc4f69638ac05cd67e95338))
* Add happy-dom dep, extract webhookSignature module, clean up worker ([e1d7767](https://github.com/ritik4ever/stellar-stream/commit/e1d7767fcb944392cbbbfcee6c07384084669053))
* Add health checks for backend and frontend in docker-compose ([b6ec5f3](https://github.com/ritik4ever/stellar-stream/commit/b6ec5f37a3316ffc8349beb69cf38145510d8cc0))
* Await async updateStreamStartAt calls in tests ([42a78a1](https://github.com/ritik4ever/stellar-stream/commit/42a78a1bd4d89531aa8350e9ca2236f8f9425cd1))
* Await async updateStreamStartAt calls in tests ([535bab8](https://github.com/ritik4ever/stellar-stream/commit/535bab80161db551ce1ecad53cdae8675cf5faea))
* **backend:** Define boundary behavior for Stream search endpoint ([#1244](https://github.com/ritik4ever/stellar-stream/issues/1244)) ([a5ec784](https://github.com/ritik4ever/stellar-stream/commit/a5ec784ee6e8693d27fd3b5a074fea5d588062ae))
* **backend:** Resolve merge conflict with main for metrics endpoints ([71665cb](https://github.com/ritik4ever/stellar-stream/commit/71665cbaddc1dfd231353c60627b7b60f919f392))
* **backend:** Resolve unhandled promise rejections and test suite issues ([778896d](https://github.com/ritik4ever/stellar-stream/commit/778896d356d6d348239ce6ed9be83c9f236b21df))
* **ci:** Resolve failing checks for [#859](https://github.com/ritik4ever/stellar-stream/issues/859) ([dd5e264](https://github.com/ritik4ever/stellar-stream/commit/dd5e2649acbad068c6982f95ed1c35928818fb15))
* **ci:** Resolve failing checks for [#859](https://github.com/ritik4ever/stellar-stream/issues/859) ([867c9bc](https://github.com/ritik4ever/stellar-stream/commit/867c9bc816b8ef50f009458ee1e7b0b1381f0822))
* **contract:** Handle native sentinel in create_split_stream ([#120](https://github.com/ritik4ever/stellar-stream/issues/120)) ([e00be7b](https://github.com/ritik4ever/stellar-stream/commit/e00be7b62138bc2a4cd1dc713623339de14b0235))
* Enforce minimum stream duration validation ([6e1e10a](https://github.com/ritik4ever/stellar-stream/commit/6e1e10a190affe44055bb101b6f24bd8bff3115d))
* Format percentComplete with consistent precision in StreamsTable ([c89c9c0](https://github.com/ritik4ever/stellar-stream/commit/c89c9c00c45383ab9ca25411d21134f7efde44e9))
* Format vestedAmount with consistent 6-decimal precision in StreamsTable ([526aaaa](https://github.com/ritik4ever/stellar-stream/commit/526aaaa285be14843c49bb8c95daca3dc00eb125))
* **frontend:** Address review comments and fix duration logic in SenderDashboard ([90f3f9c](https://github.com/ritik4ever/stellar-stream/commit/90f3f9c2d90746ef712883bef01ecdf78a4a87cd))
* **frontend:** Render estimatedEndLabel and increase docstring coverage ([42c8b95](https://github.com/ritik4ever/stellar-stream/commit/42c8b95c971959da1b087fdad6d6bd5493630516))
* **frontend:** Resolve unit test suite failures and add api/websocket/contract mocking ([95c7b59](https://github.com/ritik4ever/stellar-stream/commit/95c7b59fa884bc82f6a0a1de28486ae79f907a4d))
* Harden webhook urls and add GitHub templates ([edffa4a](https://github.com/ritik4ever/stellar-stream/commit/edffa4ad6c502080f2ddd6966455866fa3fcd1ed))
* Impl ([decebeb](https://github.com/ritik4ever/stellar-stream/commit/decebeb32e80923a7a2ca2169798ae337aacba4e))
* Implement issues [#214](https://github.com/ritik4ever/stellar-stream/issues/214), [#213](https://github.com/ritik4ever/stellar-stream/issues/213), [#218](https://github.com/ritik4ever/stellar-stream/issues/218), [#220](https://github.com/ritik4ever/stellar-stream/issues/220) ([fbcfd63](https://github.com/ritik4ever/stellar-stream/commit/fbcfd63f13398ade3f5ec045efcbfb4fa8ca2ce1))
* Native-token address getter/setter, contract fuzz tests, two compile blockers ([#688](https://github.com/ritik4ever/stellar-stream/issues/688) [#697](https://github.com/ritik4ever/stellar-stream/issues/697)) ([db89944](https://github.com/ritik4ever/stellar-stream/commit/db8994476c0419b5eef1043b4249e1c45fbcbbf3))
* **ops:** Fail fast on invalid Docker Compose backend config ([#1272](https://github.com/ritik4ever/stellar-stream/issues/1272)) ([b063c13](https://github.com/ritik4ever/stellar-stream/commit/b063c13f5cd18b1681c86f5016355b6a239e4dae))
* **ops:** Preflight deployment network and RPC config ([#1278](https://github.com/ritik4ever/stellar-stream/issues/1278)) ([ba6c6c3](https://github.com/ritik4ever/stellar-stream/commit/ba6c6c38de3d479dbb6d155ff039ab268a96a9ea))
* **ops:** Validate SQLite restore in clean environment ([#1219](https://github.com/ritik4ever/stellar-stream/issues/1219)) ([#1266](https://github.com/ritik4ever/stellar-stream/issues/1266)) ([dabe937](https://github.com/ritik4ever/stellar-stream/commit/dabe9379db6da73f0c2ae11af274ccc322447aa9))
* Remove duplicate imports in StreamsTable test, align error message with test ([2b4c6a2](https://github.com/ritik4ever/stellar-stream/commit/2b4c6a28870d7218215cee9d76b3c75a07f4bc9f))
* Resolve 18 failing tests across backend and frontend ([51e81f3](https://github.com/ritik4ever/stellar-stream/commit/51e81f3c030ad9cd25ab29caddae5d0e3c7dab3d))
* Resolve all CodeRabbit review comments and CI issues ([f206e41](https://github.com/ritik4ever/stellar-stream/commit/f206e41c7ea2e1e496265d588ebfccee2c33ee94))
* Resolve ERR_REQUIRE_ESM in frontend tests ([6b4ed11](https://github.com/ritik4ever/stellar-stream/commit/6b4ed119a211300e9b5df13216e152076de237e4)), closes [#304](https://github.com/ritik4ever/stellar-stream/issues/304)
* Resolve issue [#1234](https://github.com/ritik4ever/stellar-stream/issues/1234) - restore frontend dependency validation ([#1248](https://github.com/ritik4ever/stellar-stream/issues/1248)) ([f077c30](https://github.com/ritik4ever/stellar-stream/commit/f077c30f740772552bd2e5b10e4572734e18a57e))
* Resolve issue [#1235](https://github.com/ritik4ever/stellar-stream/issues/1235) - document dependency recovery ([#1250](https://github.com/ritik4ever/stellar-stream/issues/1250)) ([6ff87f5](https://github.com/ritik4ever/stellar-stream/commit/6ff87f566a0bccabc8dce32717b89a370098233e))
* Resolve issue [#738](https://github.com/ritik4ever/stellar-stream/issues/738) ([d22924d](https://github.com/ritik4ever/stellar-stream/commit/d22924ddddd1c8b37ba05ffaad6c969908c43f5f))
* Resolve merge conflict, dedupe startServer, sanitize cancel errors, tighten test assertions, fix paused-duration vesting calc ([83fb9ba](https://github.com/ritik4ever/stellar-stream/commit/83fb9bad57aa938d62dcf39a06dd7e74a1ea5d6c))
* Resolve merge conflicts with upstream/main ([5c61e09](https://github.com/ritik4ever/stellar-stream/commit/5c61e092e1a1190d14b8dc5be449d799efb3c02c))
* Resolve pre-existing test failures across multiple test files ([984f7e2](https://github.com/ritik4ever/stellar-stream/commit/984f7e25872270c596cae35a9395cee94bba039a))
* Resolve pre-existing test failures across multiple test files ([359309b](https://github.com/ritik4ever/stellar-stream/commit/359309bec52444c9de505769a59ea0d9495fa4c5))
* Resolve TypeScript build errors causing CI failures ([583379c](https://github.com/ritik4ever/stellar-stream/commit/583379c326a57528cb0ef2241b9eb8be30f12b16))
* Restore auth protection for protected routes ([423d4b6](https://github.com/ritik4ever/stellar-stream/commit/423d4b650a39e8e0f1f27a34ec7d1f9ceddc9b43))
* **streams:** Apply asset and q filters with AND logic (bug [#728](https://github.com/ritik4ever/stellar-stream/issues/728)) ([#1256](https://github.com/ritik4ever/stellar-stream/issues/1256)) ([9285717](https://github.com/ritik4ever/stellar-stream/commit/9285717e4b0fa53cb392c4bbc1120534b93655f9))
* Use toFixed(2) directly for percentComplete and vestedAmount display ([461f948](https://github.com/ritik4ever/stellar-stream/commit/461f9481436448ac1c25ba834e3646794133fc44))
* Use unfiltered total count for EmptyState; stable scroll handler; tests ([7b91434](https://github.com/ritik4ever/stellar-stream/commit/7b914340dc7c22f7f14a404d7871e5d31af12955))
* Validate Soroban env vars on startup ([b3a3dd3](https://github.com/ritik4ever/stellar-stream/commit/b3a3dd313f63e9c092c0315e5413ef219ceb4d13))
* Validate startAt must be at least 10 seconds in the future ([eb43f15](https://github.com/ritik4ever/stellar-stream/commit/eb43f15877df48f0d5daebcbc76febfc30a6edc3)), closes [#611](https://github.com/ritik4ever/stellar-stream/issues/611)
* **webhooks:** Prune dead-letter queue ([b8db5d1](https://github.com/ritik4ever/stellar-stream/commit/b8db5d1dcd838440d12595a47257fa7d3d8c088f)), closes [#605](https://github.com/ritik4ever/stellar-stream/issues/605)


### Documentation

* **#427:** Add ADR 0001 for SQLite vs PostgreSQL decision ([e71516b](https://github.com/ritik4ever/stellar-stream/commit/e71516bc5dcb097193d21b1cbd2b0a99001a85f4))
* **#429:** Add JSDoc to all exported functions in streamStore.ts ([6852954](https://github.com/ritik4ever/stellar-stream/commit/685295481038705b9b6e8b01dc382b7d2e1feec8))
* Add ADR for Soroban contract integration approach ([7d8fd04](https://github.com/ritik4ever/stellar-stream/commit/7d8fd0449fed5d35827a236dd959432d1701003a))
* Add ADR set for key decisions ([1e4adb5](https://github.com/ritik4ever/stellar-stream/commit/1e4adb5fb8f01f6dfb34cd403ca764806c169601))
* Add comprehensive environment variable reference table ([#800](https://github.com/ritik4ever/stellar-stream/issues/800)) ([75b261f](https://github.com/ritik4ever/stellar-stream/commit/75b261fd9b9907b3f570ed0419517fb6aca7757c))
* Add JSDoc docstrings to all undocumented functions across backend and frontend ([1c81d69](https://github.com/ritik4ever/stellar-stream/commit/1c81d698e82bdae5e5b03654efa4a0b25068e2d4))
* Add load testing guide ([29bc6d9](https://github.com/ritik4ever/stellar-stream/commit/29bc6d91230b367ae87518fcd7452f18705b6502)), closes [#815](https://github.com/ritik4ever/stellar-stream/issues/815)
* Add Mermaid sequence diagrams and clean up formatting in README.md ([d18f8a8](https://github.com/ritik4ever/stellar-stream/commit/d18f8a8844522312567a809e2d3a165305af3a99))
* Add multi-language README (Spanish and Portuguese) ([72de34e](https://github.com/ritik4ever/stellar-stream/commit/72de34e245892678980b07eeac2447acf3f958fa)), closes [#801](https://github.com/ritik4ever/stellar-stream/issues/801)
* Add seed-streams.js documentation to CONTRIBUTING.md ([5e2d91b](https://github.com/ritik4ever/stellar-stream/commit/5e2d91bec6dd55ea41701399400bde3c4eed875a))
* Add Soroban contract development quick-start guide (closes [#272](https://github.com/ritik4ever/stellar-stream/issues/272)) ([83b3823](https://github.com/ritik4ever/stellar-stream/commit/83b3823dd7d43079d4f5913469d22b454f0cf09e))
* Add stream math edge-case documentation ([20b847b](https://github.com/ritik4ever/stellar-stream/commit/20b847b4cfbf02b5181c3ef5587468b3790908aa))
* Add stream use case examples to docs ([#810](https://github.com/ritik4ever/stellar-stream/issues/810)) ([b1a0067](https://github.com/ritik4ever/stellar-stream/commit/b1a0067aaee8717146732d885829e25254ec8b3e))
* Address review feedback in USE_CASES.md ([#810](https://github.com/ritik4ever/stellar-stream/issues/810)) ([7a624c6](https://github.com/ritik4ever/stellar-stream/commit/7a624c640da75f6902ff3b4f4adc229a4c8f5774))
* **coc:** Expand CODE_OF_CONDUCT.md with enforcement examples and channels ([53ff7ef](https://github.com/ritik4ever/stellar-stream/commit/53ff7ef0a9ee9fc154ccc58fd274a06687670e84)), closes [#804](https://github.com/ritik4ever/stellar-stream/issues/804)
* **CONTRIBUTING:** Expand contributing guide with setup checklist, Soroban setup, common errors, and PR checklist ([1169823](https://github.com/ritik4ever/stellar-stream/commit/116982362e134f32544aa9213102300b8c09c78a)), closes [#803](https://github.com/ritik4ever/stellar-stream/issues/803)
* **deployment:** Expand DEPLOYMENT.md with Vercel and Render guides ([d6e04da](https://github.com/ritik4ever/stellar-stream/commit/d6e04da051722b5a04beda59ca82c16c039eb0d2))
* Document contract storage layout and migrations ([ac1855a](https://github.com/ritik4ever/stellar-stream/commit/ac1855a08f4d83055115f2117a0b099e892b66aa))
* Expand CONTRACT_BINDINGS.md with generation, upgrade, and troubleshooting guides ([5e5ee50](https://github.com/ritik4ever/stellar-stream/commit/5e5ee50919118fcc9b20930ea20223a5e55dfcd5))
* Expand maintainer guide ([1992f5e](https://github.com/ritik4ever/stellar-stream/commit/1992f5e3c588ee1fbcb1d02351cdc48edd516143))
* Reformat README with improved layout and LaTeX math notation ([d9feee6](https://github.com/ritik4ever/stellar-stream/commit/d9feee6046b5d2eba337e85a90d841dab56860e4))
* Scope note for [#690](https://github.com/ritik4ever/stellar-stream/issues/690) and [#673](https://github.com/ritik4ever/stellar-stream/issues/673) ([6378c0b](https://github.com/ritik4ever/stellar-stream/commit/6378c0b681ad2ff81c4f3e747e4a8becace3715a))
* Update BULK_SELECTION docs and add keyboard shortcuts ([#807](https://github.com/ritik4ever/stellar-stream/issues/807)) ([4b23ca1](https://github.com/ritik4ever/stellar-stream/commit/4b23ca1b057a6700796f95df0f13fb486126ff2b))
* Update INTEGRATION_TESTS_SUMMARY.md with current coverage and how-to guides ([551c59e](https://github.com/ritik4ever/stellar-stream/commit/551c59e1c8a5345255e23ef55e0dc2cf2e9bd451))
* Update PR_DESCRIPTION.md with current project state ([#811](https://github.com/ritik4ever/stellar-stream/issues/811)) ([cb28dc2](https://github.com/ritik4ever/stellar-stream/commit/cb28dc29e692514c83cfd81ecd465a5fdae5271a))


### Tests

* Add contract unit tests for all stream state transitions ([#594](https://github.com/ritik4ever/stellar-stream/issues/594)) ([7be8075](https://github.com/ritik4ever/stellar-stream/commit/7be8075dd558de1a378a74efab917a511c5ebb10))
* Add EditStartTimeModal validation and save flow tests ([edf6088](https://github.com/ritik4ever/stellar-stream/commit/edf60881561d2a960496917a53621d5a5ff268c3))
* Add integration test for webhook worker retry and dead-letter flow ([816cad3](https://github.com/ritik4ever/stellar-stream/commit/816cad38f7f05c1bcc7d2485eec65acd5eff6bf8)), closes [#374](https://github.com/ritik4ever/stellar-stream/issues/374)
* Add repeatable verification for webhook monitoring ([#1253](https://github.com/ritik4ever/stellar-stream/issues/1253)) ([0f75e2f](https://github.com/ritik4ever/stellar-stream/commit/0f75e2f705dd4638bd70ed03bec6cbba50e978b3))
* Add streams pagination and filtering integration coverage ([8637c91](https://github.com/ritik4ever/stellar-stream/commit/8637c91e2f4da00ead525ff463b1105a29ba24b9))
* Add supertest integration tests for all auth-protected routes ([#375](https://github.com/ritik4ever/stellar-stream/issues/375)) ([8dca00d](https://github.com/ritik4ever/stellar-stream/commit/8dca00d9126e4e222707e507f0482aaf9bd1d189))
* Add test for cancel refund amount after partial claim ([3b3e1b7](https://github.com/ritik4ever/stellar-stream/commit/3b3e1b75b47ba5fd5e7f8964045b606a4f3e22f3))
* Add unit tests for indexer circuit breaker state transitions ([#225](https://github.com/ritik4ever/stellar-stream/issues/225)) ([1e15698](https://github.com/ritik4ever/stellar-stream/commit/1e15698e0034c8c1f0bd0a493ac937d093bad9ea))
* Add unit tests for StreamMetricsChart data series and empty state ([08fa38b](https://github.com/ritik4ever/stellar-stream/commit/08fa38b7dbdc4f5482232153ee47bcd390390b95))
* Add unit tests for validateEnv/ StreamsTable – cancel/ RecipientDashboard / CreateStreamForm ([06a8d6e](https://github.com/ritik4ever/stellar-stream/commit/06a8d6e137b9bb69e77b1cbd66747f4947e81b78))
* Add weekly autocannon load test workflow (Resolves [#426](https://github.com/ritik4ever/stellar-stream/issues/426)) ([f31a920](https://github.com/ritik4ever/stellar-stream/commit/f31a920914b98bbbbff6c74c580880a543d683a3))
* **backend:** Add progress verification to sender streams integration test ([#240](https://github.com/ritik4ever/stellar-stream/issues/240)) ([28674cb](https://github.com/ritik4ever/stellar-stream/commit/28674cbf945606c8ba7e0a4ff5ebc54b471a80b2))
* **backend:** Verify environment variable overrides for assets allowlist ([#238](https://github.com/ritik4ever/stellar-stream/issues/238)) ([6975216](https://github.com/ritik4ever/stellar-stream/commit/6975216faecc2862846cfb1d347df1e1d166c78b))
* **ci:** Add MSW /api/config handler; fix IssueBacklog tests; exclude tests from tsc; guard VitePWA in CI; add StreamsTable optional props ([9ab39df](https://github.com/ritik4ever/stellar-stream/commit/9ab39df86a98979382327982f6a3c68b35a35109))
* **contracts:** Add get_split_children empty Vec tests ([#212](https://github.com/ritik4ever/stellar-stream/issues/212)) ([b659beb](https://github.com/ritik4ever/stellar-stream/commit/b659bebe65316857b8ff2704cb0f2a8a69d964da))
* **contracts:** Verify authority over stream state from a previous build ([#1181](https://github.com/ritik4ever/stellar-stream/issues/1181)) ([#1290](https://github.com/ritik4ever/stellar-stream/issues/1290)) ([a413675](https://github.com/ritik4ever/stellar-stream/commit/a413675b20d9542c3d70c27073f530abba7749c0))
* **deps:** Add repeatable dependency verification ([#1247](https://github.com/ritik4ever/stellar-stream/issues/1247)) ([552b6ab](https://github.com/ritik4ever/stellar-stream/commit/552b6abdf37852c159f152d34706426a1e4f2d54))
* Expand and update stream contract test snapshots to include new features and state validations ([4ba8127](https://github.com/ritik4ever/stellar-stream/commit/4ba8127463c43b5840b26ccb33779758748cbd92))
* Extend API test coverage for errors and auth headers ([4e2f201](https://github.com/ritik4ever/stellar-stream/commit/4e2f201ec761c969e81690b74c19bdb7a26a2e5f))
* Fix pino-pretty transport in test environment ([c36ddef](https://github.com/ritik4ever/stellar-stream/commit/c36ddefa07ff51ac4edc1cab751a8cd094eb3e20))
* **frontend:** Add SenderDashboard test coverage and creation entry point ([00319a6](https://github.com/ritik4ever/stellar-stream/commit/00319a641bd194fd0559be92bd38838f7558e75d))
* **frontend:** Add SenderDashboard test coverage and resolve merge conflicts ([2e9cd1a](https://github.com/ritik4ever/stellar-stream/commit/2e9cd1a0abcb7e89e5788b6f7ac111b2d1b04f23))
* **indexer:** Add gap-fill tests for restart recovery ([c26c428](https://github.com/ritik4ever/stellar-stream/commit/c26c428a027839ae73a1ccdfefd9fe4dd78dedc8))
* **indexer:** Validate monitoring scenarios in clean environment ([#1267](https://github.com/ritik4ever/stellar-stream/issues/1267)) ([309fc09](https://github.com/ritik4ever/stellar-stream/commit/309fc09314ccc788819e968010d9aaea178ab647))
* **streamStore:** Add unit tests for getStreamById and handle archived streams ([#313](https://github.com/ritik4ever/stellar-stream/issues/313)) ([f35c91a](https://github.com/ritik4ever/stellar-stream/commit/f35c91ab188cd4179bef1dc29904f868356a380d))


### Build System

* **deps:** Bump the all-dependencies group ([#1258](https://github.com/ritik4ever/stellar-stream/issues/1258)) ([271f008](https://github.com/ritik4ever/stellar-stream/commit/271f00851522336903736cd828012e3853834efd))
* **deps:** Bump the all-dependencies group in /backend with 22 updates ([#1257](https://github.com/ritik4ever/stellar-stream/issues/1257)) ([c73c348](https://github.com/ritik4ever/stellar-stream/commit/c73c348845e3cb14d06395515e67a1be2ccbfdbc))


### CI/CD

* Add Lighthouse CI performance budget for frontend ([e404491](https://github.com/ritik4ever/stellar-stream/commit/e40449179b4f6df57fdeba81edf4b3db808dcf6b))
* Add lint, type-check, and coverage threshold to backend CI ([cd1ca54](https://github.com/ritik4ever/stellar-stream/commit/cd1ca54c83e4d4d836e2e5665a0203ee5eb74965))
* **frontend:** Detect and bound retries for browser test timeouts ([c126f46](https://github.com/ritik4ever/stellar-stream/commit/c126f465473d2332950448d3a1a9712f2b10c229))


### Chores

* **eslint:** Add flat config with typescript and react rules, fix core compilation bugs ([11476ba](https://github.com/ritik4ever/stellar-stream/commit/11476ba6c54080f9d2dc10c278f1159c559d1b78))

## [Unreleased]

### Added

- Initial changelog scaffold for back-filled release history.
- Docker Compose startup now runs a configuration preflight against `backend/.env` before starting any container. An empty environment, missing or invalid Soroban credentials, malformed URLs, an empty asset allowlist, or a `PORT` that does not match the Compose healthcheck port all fail with exit `2`, a useful non-sensitive message, and no partial rollout. See [RUNBOOK.md](RUNBOOK.md#docker-compose-startup-failure).
- A `DB_PATH` outside the persisted `/app/data` volume now logs a startup warning that the SQLite database will be recreated on every container start.

## [2026-04-27]

### Added

- Split streams support in the Soroban contract, including parent/child stream linkage and `create_split_stream`.
- Contract tests covering split stream creation, child stream lookup, and per-substream claim/cancel behavior.

## [2026-04-26]

### Added

- Stream pause and resume support in the contract.
- Contract test coverage for pause/resume behavior and vesting extension after a pause.

### Changed

- JWT hardening and related contract test coverage improvements.

## [2026-03-27]

### Added

- Initial backend API and frontend UI for the Stellar Stream application.

## [2026-03-26]

### Added

- Global event history API at `GET /api/events`.
- Webhook retry queue support for delivery failures.

## [2026-02-26]

### Added

- Webhook notifications with exponential backoff.

## [2026-02-24]

### Added

- Stream event history system.
