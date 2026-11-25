import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [cloudflare],
  env: cloudflare.env,
  ignorePatterns: [
    ...cloudflare.ignorePatterns,
    "dist/**",
    ".wrangler/**",
    ".tanstack/**",
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
    "demo/fixture/**",
    // Symlinks to .cursor/skills, so each file is linted once.
    ".claude/skills/**",
    ".agents/skills/**",
  ],
  rules: {
    curly: ["error", "multi-line"],
    "unicorn/prefer-import-meta-properties": "off",
    "unicorn/prefer-single-call": "off",
    "unicorn/text-encoding-identifier-case": ["error", { withDash: true }],
  },
  overrides: [
    { files: ["scripts/**", "demo/**", "bin/**", ".cursor/skills/**"], rules: { "no-console": "off" } },
    // @cloudflare/oxlint-config turns no-explicit-any off in test files. Keep it on everywhere.
    {
      files: ["**/*.{test,spec,integration,e2e}.{ts,tsx,mts,cts}", "**/__tests__/**/*.{ts,tsx,mts,cts}"],
      rules: { "typescript/no-explicit-any": "error" },
    },
  ],
});
