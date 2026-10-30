import "dotenv/config";
import * as pg from "pg";
import { sslForDatabaseUrl } from "./pgSsl.mjs";

const { Pool } = pg.default;

const connectionString =
  process.env.DATABASE_URL || process.env.CONNECTION_STRING;

const connectionPool = new Pool({
  connectionString,
  ssl: sslForDatabaseUrl(connectionString),
});

export default connectionPool;
