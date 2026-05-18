import { defineConfig } from "tsup";

// Bundle the agent and workspace packages into one JS entrypoint, but leave the
// Claude Agent SDK external. The SDK ships a platform-specific native Claude
// Code binary; Docker must install/copy node_modules so the linux binary is
// available at runtime.
//
// The `banner` adds a small ESM require bridge because some bundled CJS deps
// call `require()`, which does not exist natively in ESM.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  noExternal: [/^@novamind\//],
  external: [/^@anthropic-ai\/claude-agent-sdk/],
  banner: {
    js: "import { createRequire as __novamind_cr } from 'module'; const require = __novamind_cr(import.meta.url);",
  },
});
