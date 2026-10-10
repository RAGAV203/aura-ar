import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

/**
 * Aura ships as a fully static export: every instrument, the audio engine and
 * the vision pipeline run in the browser, so no server runtime is needed. This
 * also keeps the service worker's precache list deterministic (see
 * scripts/generate-sw-manifest.mjs).
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
