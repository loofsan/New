import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Development environment component tagger
    if (process.env.NODE_ENV === "development") {
      config.module.rules.push({
        test: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
        enforce: "pre",
        use: "@dyad-sh/nextjs-webpack-component-tagger",
      });
    }

    // Handle pdf-parse module for server-side
    if (isServer) {
      // Externalize pdf-parse to prevent bundling issues
      config.externals = [...(config.externals || []), "pdf-parse"];
    }

    return config;
  },
  // Use the correct property name for external packages
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
