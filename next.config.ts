import type { NextConfig } from "next";

/**
 * Every Tagalingo screen is per-learner and read fresh from Postgres, so the Cache Components
 * model is left off: pages render dynamically and server actions revalidate the paths they change.
 */
const nextConfig: NextConfig = {
  typedRoutes: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
