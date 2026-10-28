import type { NextConfig } from "next";

// Project Pages URL is https://neversmile0825.github.io/pairsheet/
// When pairsheet.site is pointed at this repo, keep the same path or serve from a
// root Pages site; until then assets must be prefixed with /pairsheet.
const repoBase = "/pairsheet";

const nextConfig: NextConfig = {
  // GitHub Pages serves the exported `out` directory. Chain data is read in the
  // browser from public APIs, so the site does not need a Node server.
  output: "export",
  basePath: repoBase,
  assetPrefix: repoBase,
  images: { unoptimized: true },
  // The dev server is bound on 0.0.0.0 and opened at 127.0.0.1. Next blocks
  // the HMR socket for that host unless it is listed, and hydration waits on
  // that socket in development.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
