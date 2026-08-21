import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * Every route in one place. Next's file-based routing derived the path from the
 * folder structure; React Router says it out loud, so the `/api/...` paths and
 * the browser code calling them cannot drift apart.
 */
export default [
  index("routes/studio.tsx"),
  route("onboarding", "routes/onboarding.tsx"),

  // Resource routes: no default export, just loader/action.
  route("api/extract", "routes/api.extract.ts"),
  route("api/analyze", "routes/api.analyze.ts"),
  route("api/cohorts", "routes/api.cohorts.ts"),
  route("api/generate", "routes/api.generate.ts"),
  route("api/video", "routes/api.video.ts"),
  route("api/validate", "routes/api.validate.ts"),
  route("api/zip", "routes/api.zip.ts"),
  route("api/book", "routes/api.book.ts"),
] satisfies RouteConfig;
