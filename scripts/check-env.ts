import { loadEnv } from "./load-env";
loadEnv();

const KEYS = [
  "MEDPLUM_BASE_URL",
  "MEDPLUM_CLIENT_ID",
  "MEDPLUM_CLIENT_SECRET",
  "VITE_MEDPLUM_CLIENT_ID",
  "DEEPGRAM_API_KEY",
  "MOSS_PROJECT_ID",
  "MOSS_PROJECT_KEY",
  "STEDI_API_KEY",
];

console.log("Env status (values never printed):\n");
for (const key of KEYS) {
  console.log(`  ${process.env[key] ? "✓" : "✗"} ${key}`);
}
