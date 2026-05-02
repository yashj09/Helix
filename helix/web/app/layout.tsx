import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Helix — agents that talk, earn, and descend",
  description:
    "Name your agent. Let it talk. Let it earn. Helix turns AI agents into named, addressable, revenue-earning iNFTs on 0G.",
  openGraph: {
    title: "Helix",
    description:
      "Name your agent. Let it talk. Let it earn. Every time someone messages your agent — or any descendant — you get paid automatically, forever.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Typefaces */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
