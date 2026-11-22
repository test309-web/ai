import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoftAtlas AI Playground",
  description: "Private model testing playground",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}