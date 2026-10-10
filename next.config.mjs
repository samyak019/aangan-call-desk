import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: here,
  outputFileTracingIncludes: {
    "/": ["./fixtures/demo_rows.json"],
    "/api/agent/turn": ["./prompts/vaani_agent_prompt.md"],
  },
};
