import { timingSafeEqual } from "node:crypto";

// Shared-secret check for calls from the voice platform (header or ?secret=).
export function authorised(req: Request): boolean {
  const expected = process.env.VAANI_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production"; // open locally, closed in prod until set
  const got = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
