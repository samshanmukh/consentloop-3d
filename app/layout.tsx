import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProtocol ?? (host.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: {
      default: "ConsentLoop 3D",
      template: "%s · ConsentLoop 3D",
    },
    description:
      "A simple patient-education experience for understanding a diagnosis, comparing options, and viewing a procedure step by step in 3D.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "ConsentLoop 3D",
      description:
        "Understand the diagnosis, compare care paths, and view the procedure one step at a time.",
      type: "website",
      images: [{ url: socialImage, width: 1680, height: 945, alt: "ConsentLoop 3D interactive knee consent experience" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ConsentLoop 3D",
      description: "A simpler way to understand a diagnosis and procedure.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
