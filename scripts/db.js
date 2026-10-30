import dotenv from "dotenv";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

// Load environment variables from the parent directory's .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { Pool } = pg;

// Automatic fallback to standard Postgres env variables (PGUSER, PGDATABASE, PGPASSWORD, PGPORT, PGHOST, DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: false,
  ssl: {
    rejectUnauthorized: false, // Use true in production with valid certificates
  },
});

// Prevent Node process from crashing if an idle PostgreSQL client disconnects
pool.on("error", (err) => {
  console.error(
    "⚠️ [PostgreSQL Pool] Unexpected error on idle client:",
    err.message,
  );
});

export const query = (text, params) => pool.query(text, params);

export default pool;
