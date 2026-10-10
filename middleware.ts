// Dashboard holds caller names/numbers — lock it with basic auth when DASHBOARD_PASSWORD is set.
// API routes have their own shared-secret check.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Aangan Call Desk"' },
  });
}

export const config = { matcher: ["/((?!api/|_next/|call|favicon.ico).*)"] };
