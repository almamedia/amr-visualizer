import type { Config } from "@react-router/dev/config";

export default {
  /**
   * Server rendering on. The app needs a server either way — page fetching,
   * the Claude calls and Playwright rendering all run there — so SPA mode
   * would save nothing.
   */
  ssr: true,
} satisfies Config;
