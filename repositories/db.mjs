import pg from "pg";
import "dotenv/config";
import { sslForDatabaseUrl } from "../utils/pgSsl.mjs";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  ssl: sslForDatabaseUrl(connectionString),
  connectionTimeoutMillis: 8000,
});
