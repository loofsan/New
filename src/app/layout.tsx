import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Public Speaking Practice Platform",
  description: "Practice public speaking with AI-powered scenarios",
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="%233b82f6" rx="6"/><text x="16" y="24" font-size="20" text-anchor="middle" fill="white">🎤</text></svg>',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}