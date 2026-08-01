import { MedplumClient, ClientStorage, MemoryStorage } from "@medplum/core";

let cached: MedplumClient | null = null;

/**
 * Server-side Medplum client using client-credentials auth, for scripts and
 * bot-adjacent tooling that runs outside the Medplum bot runtime itself (bot
 * handlers receive an already-authenticated `medplum` argument and should not
 * call this).
 *
 * Create a ClientApplication at app.medplum.com → Admin → Client Applications.
 */
export async function getMedplum(): Promise<MedplumClient> {
  if (cached) return cached;

  const baseUrl = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/";
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET missing from .env.local"
    );
  }

  // Node exposes a partial `localStorage` global, which defeats Medplum's
  // browser-vs-server auto-detection inside ClientStorage. Pass an in-memory
  // store explicitly so this works in scripts regardless of Node version.
  const medplum = new MedplumClient({
    baseUrl,
    storage: new ClientStorage(new MemoryStorage()),
  });

  await medplum.startClientLogin(clientId, clientSecret);
  cached = medplum;
  return medplum;
}
