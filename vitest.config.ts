import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Empty, not absent: an empty value stops .env being loaded, so no test
    // can reach Knock even when a real key is on this machine.
    env: { KNOCK_SECRET_API_KEY: "" },
    exclude: [...configDefaults.exclude],
  },
});
