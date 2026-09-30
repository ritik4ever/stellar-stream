// `import "dotenv/config"` has no bundled type declarations for the
// sub-path export, which TypeScript 6 rejects as an untyped side-effect
// import (TS2882). This ambient declaration satisfies it.
declare module "dotenv/config";
