import "./globals.css";

export const metadata = { title: "Aangan Call Desk", description: "Inbound call qualification dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
