import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Alpha Radar",
    short_name: "Alpha Radar",
    start_url: "/events",
    scope: "/",
    display: "standalone",
    background_color: "#101418",
    theme_color: "#101418",
    icons: [
      { src: "/event-alert-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/event-alert-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
