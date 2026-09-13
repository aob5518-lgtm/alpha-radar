import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Alpha Radar",
  description: "Financial intelligence and asset discovery platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
