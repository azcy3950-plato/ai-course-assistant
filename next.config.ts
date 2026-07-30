import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Server mode for SWMM API routes (not static export)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
