import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load monorepo-root .env so the agent has API keys available at runtime.
// Idempotent — safe to import multiple times. Production deploys (Cloudflare
// Containers etc.) inject env vars directly, in which case the .env file is
// absent and dotenv silently no-ops.
const here = dirname(fileURLToPath(import.meta.url));
// override: true — the shell may export an empty provider-key variable, which
// would otherwise shadow the value in .env.
config({ path: resolve(here, "../../../.env"), override: true, quiet: true });
