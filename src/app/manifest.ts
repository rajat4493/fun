import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "F.U.N - One perfect pick",
    short_name: "F.U.N",
    description: "One mood-aware movie or series recommendation, verified where possible.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#030303",
    theme_color: "#030303",
    orientation: "portrait-primary",
    categories: ["entertainment", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Find my pick",
        short_name: "Find a pick",
        description: "Tell F.U.N what you need tonight.",
        url: "/",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Memory",
        short_name: "Memory",
        description: "Review your recent recommendations.",
        url: "/memory",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
