import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

/**
 * Archivo on AMR Design Systemin ainoa kirjasin. Painot 100 / 400 / 800 ovat
 * ainoat lisensoidut; käyttöliittymä käyttää niistä kahta (400 ja 800), koska
 * sommitelmassa saa olla enintään kaksi painoa.
 */
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "800"],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "AMR Aineistostudio",
  description:
    "Syötä verkkosivusi osoite ja saat valmiit, spec-yhteensopivat mainosaineistot Alman medioihin.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fi" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
