import { existsSync } from "node:fs";
import path from "node:path";

// Integration tests talk to the local database and need the Testnet
// service accounts, all of which live in the gitignored .env. Unit tests
// do not depend on it, so a missing file is fine (CI).
const envPath = path.resolve(__dirname, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
