import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  /**
   * Next loaded .env.local itself. Vite reads .env files only into
   * `import.meta.env`, and only for VITE_-prefixed names, but the server code
   * (lib/claude.ts) reads its key from process.env — so they are moved across
   * by hand. An empty prefix means every variable, not just VITE_ ones.
   *
   * This covers `dev` and `build`. In production react-router-serve runs
   * without Vite, so the same job is done there by Node's --env-file flag
   * (see package.json → scripts.start).
   */
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [reactRouter(), tsconfigPaths()],
    ssr: {
      /**
       * Playwright and archiver depend on native and Node-only APIs: they must
       * stay unbundled or the server build breaks. This plays the same role
       * Next's `serverExternalPackages` setting did.
       */
      external: [
        "playwright",
        "archiver",
        "@remotion/bundler",
        "@remotion/renderer",
      ],
    },
  };
});
