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
  ],
  rules: {
    curly: ["error", "multi-line"],
    "unicorn/prefer-import-meta-properties": "off",
    "unicorn/prefer-single-call": "off",
    "unicorn/text-encoding-identifier-case": ["error", { withDash: true }],
  },
  overrides: [{ files: ["scripts/**", "demo/**", "bin/**"], rules: { "no-console": "off" } }],
});
