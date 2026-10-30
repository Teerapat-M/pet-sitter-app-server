import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";
import { poolConfig } from "./migrate.mjs";

const { Client } = pg;
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed.sql");

export async function seed(connectionString = process.env.DATABASE_URL) {
  const client = new Client(poolConfig(connectionString));
  await client.connect();
  try {
    const sql = fs.readFileSync(SEED_FILE, "utf8");
    await client.query(sql);
    console.log("seed applied");
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seed().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
