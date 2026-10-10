import CallClient from "./CallClient";

export const metadata = { title: "Call Aangan Studio", description: "Talk to Meher, Aangan Studio's 24/7 voice assistant" };

export default function CallPage() {
  return (
    <main className="call-page">
      <header className="call-top">
        <a href="/" className="back">← Dashboard</a>
        <h1>Call Aangan Studio</h1>
        <p className="sub">Interior design for homes and offices in Pune &amp; PCMC. Answered 24/7.</p>
      </header>
      <CallClient />
    </main>
  );
}
