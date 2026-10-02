import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/", destination: "/events", permanent: false },
      { source: "/radar", destination: "/events", permanent: false },
      { source: "/discover", destination: "/events", permanent: false },
      { source: "/discover/:path*", destination: "/events", permanent: false },
      { source: "/strategy", destination: "/analyst", permanent: false },
      { source: "/strategy/:path*", destination: "/analyst", permanent: false },
      { source: "/watchlist", destination: "/events", permanent: false },
      { source: "/alerts", destination: "/events", permanent: false },
      { source: "/assets", destination: "/chart", permanent: false },
      {
        source: "/assets/:identifier",
        destination: "/chart?asset=:identifier",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
