import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright fixtures/config, not React code — its `test.extend`
    // fixture functions (`use(...)`) trip the react-hooks lint rules.
    "e2e/**",
    "playwright.config.ts",
  ]),
]);

export default eslintConfig;
