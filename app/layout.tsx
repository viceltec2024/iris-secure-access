import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IRIS Enterprise — Secure Access",
  description: "Identity-aware secure access for IRIS Enterprise AI.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: `(function(){function hide(){document.querySelectorAll("vite-error-overlay").forEach(function(n){n.remove();});}window.addEventListener("unhandledrejection",function(e){var m=String(e.reason&&e.reason.message||e.reason||"");if(m.indexOf("send was called before connect")!==-1){e.preventDefault();hide();}});hide();})();` }} />
        {children}
      </body>
    </html>
  );
}
