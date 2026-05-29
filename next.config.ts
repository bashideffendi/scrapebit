import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/Railway: standalone build minimal — copy cuma server.js + minimal node_modules.
  // Lokal dev tetap normal.
  output: "standalone",
};

export default nextConfig;
