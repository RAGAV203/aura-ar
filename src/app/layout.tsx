import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { AppStatus } from "@/components/feedback/AppStatus";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Aura — Move your hands. Shape your world.", template: "%s · Aura" },
  description: "A gesture-driven instrument for generative light and sound. Everything runs on your device.",
  applicationName: "Aura",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Aura", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#080914",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Content Security Policy for the static export (delivered as a meta tag
 * because static hosting has no server to set headers; public/_headers sets
 * the same policy as a real header on hosts that support it).
 * - 'unsafe-inline' scripts: required by Next.js' inline hydration payload in
 *   static exports (no per-request nonce is possible).
 * - 'wasm-unsafe-eval': required to instantiate the MediaPipe WebAssembly runtime.
 * - connect-src storage.googleapis.com: MediaPipe model downloads.
 * Not applied in development, where Next's dev tooling needs eval.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self'",
  "connect-src 'self' data: blob: https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${instrumentSerif.variable}`}>
      <head>{process.env.NODE_ENV === "production" && <meta httpEquiv="Content-Security-Policy" content={CSP} />}</head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <FeedbackProvider>
          <AppStatus />
          {children}
        </FeedbackProvider>
      </body>
    </html>
  );
}
