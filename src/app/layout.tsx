import type { Metadata } from "next";
import { StudioProvider } from "@/components/studio-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StringMentor AI · Your practice, in tune",
    template: "%s · StringMentor AI",
  },
  description:
    "A thoughtful practice space for cello and violin. Record or upload audio, explore local cello measurements, and choose evidence-based practice investigations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <StudioProvider>
          <AppShell>{children}</AppShell>
        </StudioProvider>
      </body>
    </html>
  );
}
