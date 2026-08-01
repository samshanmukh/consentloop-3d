declare namespace Cloudflare {
  interface Env {
    DEEPGRAM_API_KEY?: string;
    MEDPLUM_BASE_URL?: string;
    MEDPLUM_CLIENT_ID?: string;
    MEDPLUM_CLIENT_SECRET?: string;
    DB?: D1Database;
  }
}
