import type { NextConfig } from 'next'

/**
 * Static export for GitHub Pages.
 *
 * `basePath` is applied only in CI, so `npm run dev` serves from `/` locally
 * while the deployed site lives under `/POE2-MCP-V2`.
 *
 * There are no API routes by design: GitHub Pages serves static files only.
 * The poe.ninja fetch goes through services/ninja-proxy instead, because
 * poe.ninja sends no CORS headers and 405s preflight — a browser cannot call
 * it directly. See services/ninja-proxy/README.md.
 */
const isCI = process.env.GITHUB_ACTIONS === 'true'
const basePath = isCI ? '/POE2-MCP-V2' : ''

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

export default nextConfig
