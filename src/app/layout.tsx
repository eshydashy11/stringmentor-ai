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
    "A thoughtful practice space for cello and violin. Upload your own audio, listen closely, and build your practice routine. AI analysis is not yet implemented.",
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
