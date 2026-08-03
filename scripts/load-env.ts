import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (existsSync(path)) config({ path });
}

export function requireEnv(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}. Copy .env.local.example to .env.local and fill them in.`
    );
  }
}
