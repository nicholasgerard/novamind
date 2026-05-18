import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const browserGlobals = {
  AbortController: "readonly",
  AbortSignal: "readonly",
  console: "readonly",
  document: "readonly",
  DOMException: "readonly",
  fetch: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  ReadableStream: "readonly",
  Request: "readonly",
  Response: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  Buffer: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    ignores: [
      "**/.next/**",
      "**/.claude/**",
      "**/.open-next/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "**/tsup.config.ts",
      "**/tsup.config.bundled_*.mjs",
      "internal/**",
      "vitest.config.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [
          "./apps/agent/tsconfig.json",
          "./apps/web/tsconfig.json",
          "./packages/corpus/tsconfig.json",
          "./packages/eval/tsconfig.json",
          "./packages/pipeline/tsconfig.json",
          "./packages/shared/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { disallowTypeAnnotations: false, fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": next,
      "react-hooks": reactHooks,
    },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
    settings: {
      next: {
        rootDir: "apps/web",
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "vitest.config.ts"],
    languageOptions: {
      globals: {
        afterEach: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        vi: "readonly",
      },
    },
  },
];
