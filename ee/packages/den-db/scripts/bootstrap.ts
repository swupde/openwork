/**
 * Production install/upgrade entrypoint for Den databases.
 *
 * Empty databases are initialized from the build-time current-schema snapshot,
 * then committed migrations are recorded as the baseline. Existing databases
 * without a migration ledger are baselined before the normal migration pass.
 */
import "../src/load-env.ts"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/mysql2"
import { migrate } from "drizzle-orm/mysql2/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import mysql from "mysql2/promise"
import { parseMySqlConnectionConfig } from "../src/mysql-config.ts"
import { ensureSchemaRepairs } from "../src/schema-repairs.ts"
import { createExecutor, type Executor } from "./db-executor.ts"

const MIGRATIONS_TABLE = "__drizzle_migrations"
const LEGACY_PRE_OAUTH_BASELINE_TAG = "0055_thick_chamber"
const FIRST_POST_OAUTH_MIGRATION_TAG = "0057_codemode_scripts"
const POST_OAUTH_SCHEMA_MARKERS = ["artifact_view_revision", "temp_file", "program_agent_selection", "remote_mcp_app"]

const scriptPath = fileURLToPath(import.meta.url)
const distDir = path.resolve(path.dirname(scriptPath), "..")
const migrationsFolder = path.join(distDir, "drizzle")
const currentSchemaPath = path.join(distDir, "current-schema.sql")

function mysqlConnectionConfigFromEnv(): ReturnType<typeof parseMySqlConnectionConfig> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) {
    return parseMySqlConnectionConfig(databaseUrl)
  }

  const host = process.env.DATABASE_HOST?.trim()
  const user = process.env.DATABASE_USERNAME?.trim()
  const password = process.env.DATABASE_PASSWORD ?? ""
  const database = process.env.DATABASE_NAME?.trim()
  const portValue = process.env.DATABASE_PORT?.trim()
  const port = portValue ? Number(portValue) : 3306

  if (!host || !user || !database) {
    throw new Error("Provide DATABASE_URL, or DATABASE_HOST/DATABASE_USERNAME/DATABASE_PASSWORD/DATABASE_NAME.")
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("DATABASE_PORT must be a positive integer")
  }

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: true },
  }
}

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function applyCurrentSchema(executor: Executor) {
  const statements = splitSqlStatements(readFileSync(currentSchemaPath, "utf8"))
  if (statements.length === 0) {
    throw new Error(`No SQL statements found in ${currentSchemaPath}`)
  }

  for (const statement of statements) {
    await executor.query(statement)
  }
}

async function listTables(executor: Executor) {
  const rows = await executor.query("show tables")
  return rows
    .map((row) => Object.values(row).find((value) => typeof value === "string"))
    .filter((value): value is string => Boolean(value))
}

function latestMigrationMillis(rows: Record<string, unknown>[]) {
  const latest = rows[0]?.latest
  if (typeof latest === "number") {
    return latest
  }
  if (typeof latest === "bigint") {
    return Number(latest)
  }
  if (typeof latest === "string") {
    const parsed = Number(latest)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function migrationMillis(tag: string) {
  const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>
  }
  const migration = journal.entries.find((entry) => entry.tag === tag)
  if (!migration) {
    throw new Error(`Migration ${tag} is missing from the committed journal`)
  }
  return migration.when
}

async function baselineCommittedMigrations(executor: Executor, throughMillis = Number.POSITIVE_INFINITY) {
  const migrations = readMigrationFiles({ migrationsFolder }).sort((left, right) => left.folderMillis - right.folderMillis)

  await executor.query(
    `create table if not exists \`${MIGRATIONS_TABLE}\` (id serial primary key, hash text not null, created_at bigint)`,
  )

  const rows = await executor.query(`select max(created_at) as latest from \`${MIGRATIONS_TABLE}\``)
  const latest = latestMigrationMillis(rows)
  const pending = migrations.filter((migration) => migration.folderMillis > latest && migration.folderMillis <= throughMillis)

  if (pending.length === 0) {
    console.log("[den-db] migration baseline already current")
    return
  }

  console.log(`[den-db] recording ${pending.length} committed migrations as baseline`)
  for (const migration of pending) {
    await executor.query(`insert into \`${MIGRATIONS_TABLE}\` (hash, created_at) values (?, ?)`, [
      migration.hash,
      migration.folderMillis,
    ])
  }
}

async function tableExists(executor: Executor, table: string) {
  const rows = await executor.query(
    "SELECT 1 AS present FROM information_schema.TABLES WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [table],
  )
  return rows.length > 0
}

async function columnExists(executor: Executor, table: string, column: string) {
  const rows = await executor.query(
    "SELECT 1 AS present FROM information_schema.COLUMNS WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [table, column],
  )
  return rows.length > 0
}

async function indexExists(executor: Executor, table: string, index: string) {
  const rows = await executor.query(
    "SELECT 1 AS present FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
    [table, index],
  )
  return rows.length > 0
}

async function ensureColumn(executor: Executor, table: string, column: string, definition: string) {
  if (await columnExists(executor, table, column)) {
    return
  }
  await executor.query(`ALTER TABLE \`${table}\` ADD \`${column}\` ${definition}`)
}

async function repairMissingOauthSchema(executor: Executor) {
  // v0.18.16 installations could have a migration ledger that incorrectly
  // recorded 0056 as complete. Apply only that migration's additive schema
  // idempotently; later migrations may already have been deployed.
  console.log("[den-db] OAuth schema is missing; repairing its additive schema")
  await executor.query(`CREATE TABLE IF NOT EXISTS \`oauthClientAssertion\` (
    \`id\` varchar(64) NOT NULL,
    \`expires_at\` timestamp(3) NOT NULL,
    CONSTRAINT \`oauthClientAssertion_id\` PRIMARY KEY(\`id\`)
  )`)
  await executor.query(`CREATE TABLE IF NOT EXISTS \`oauthClientResource\` (
    \`id\` varchar(512) NOT NULL,
    \`client_id\` varchar(255) NOT NULL,
    \`resource_id\` varchar(255) NOT NULL,
    \`metadata\` text,
    \`created_at\` timestamp(3) NOT NULL DEFAULT (now()),
    CONSTRAINT \`oauthClientResource_id\` PRIMARY KEY(\`id\`)
  )`)
  await executor.query(`CREATE TABLE IF NOT EXISTS \`oauthResource\` (
    \`id\` varchar(64) NOT NULL,
    \`identifier\` varchar(255) NOT NULL,
    \`name\` varchar(255) NOT NULL,
    \`access_token_ttl\` int,
    \`refresh_token_ttl\` int,
    \`signing_algorithm\` varchar(64),
    \`signing_key_id\` varchar(255),
    \`allowed_scopes\` text,
    \`custom_claims\` text,
    \`dpop_bound_access_tokens_required\` boolean,
    \`disabled\` boolean,
    \`policy_version\` int,
    \`metadata\` text,
    \`created_at\` timestamp(3) NOT NULL DEFAULT (now()),
    \`updated_at\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT \`oauthResource_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`oauth_resource_identifier\` UNIQUE(\`identifier\`)
  )`)

  for (const [table, column, definition] of [
    ["oauthAccessToken", "authorization_code_id", "varchar(64)"],
    ["oauthAccessToken", "resources", "text"],
    ["oauthAccessToken", "requested_user_info_claims", "text"],
    ["oauthAccessToken", "revoked", "timestamp(3)"],
    ["oauthAccessToken", "confirmation", "text"],
    ["oauthClient", "backchannel_logout_uri", "text"],
    ["oauthClient", "backchannel_logout_session_required", "boolean"],
    ["oauthClient", "jwks", "text"],
    ["oauthClient", "jwks_uri", "text"],
    ["oauthClient", "dpop_bound_access_tokens", "boolean"],
    ["oauthConsent", "resources", "text"],
    ["oauthConsent", "requested_user_info_claims", "text"],
    ["oauthRefreshToken", "authorization_code_id", "varchar(64)"],
    ["oauthRefreshToken", "resources", "text"],
    ["oauthRefreshToken", "requested_user_info_claims", "text"],
    ["oauthRefreshToken", "rotated_at", "timestamp(3)"],
    ["oauthRefreshToken", "rotation_replay_response", "text"],
    ["oauthRefreshToken", "rotation_replay_expires_at", "timestamp(3)"],
    ["oauthRefreshToken", "confirmation", "text"],
  ] as const) {
    await ensureColumn(executor, table, column, definition)
  }

  if (!(await indexExists(executor, "oauthClientResource", "oauth_client_resource_client_id"))) {
    await executor.query("CREATE INDEX `oauth_client_resource_client_id` ON `oauthClientResource` (`client_id`)")
  }
  if (!(await indexExists(executor, "oauthClientResource", "oauth_client_resource_resource_id"))) {
    await executor.query("CREATE INDEX `oauth_client_resource_resource_id` ON `oauthClientResource` (`resource_id`)")
  }
}

async function reconcilePostOauthBaseline(executor: Executor) {
  const presentMarkers = [] as string[]
  for (const table of POST_OAUTH_SCHEMA_MARKERS) {
    if (await tableExists(executor, table)) {
      presentMarkers.push(table)
    }
  }

  if (presentMarkers.length === POST_OAUTH_SCHEMA_MARKERS.length) {
    console.log("[den-db] later schema is already present; recording its migration baseline")
    await baselineCommittedMigrations(executor)
    return
  }

  if (presentMarkers.length === 0) {
    console.log("[den-db] later schema is absent; replaying migrations after the repaired OAuth schema")
    await executor.query(`delete from \`${MIGRATIONS_TABLE}\` where created_at >= ?`, [migrationMillis(FIRST_POST_OAUTH_MIGRATION_TAG)])
    return
  }

  throw new Error(
    `[den-db] Incomplete post-OAuth migration state: found ${presentMarkers.join(", ")}; expected all or none of ${POST_OAUTH_SCHEMA_MARKERS.join(", ")}.`,
  )
}

async function runCommittedMigrations() {
  const connection = await mysql.createConnection(mysqlConnectionConfigFromEnv())
  try {
    const db = drizzle(connection)
    await migrate(db, { migrationsFolder })
  } finally {
    await connection.end()
  }
}

export async function bootstrapDenDb() {
  const executor = await createExecutor()
  try {
    const tables = await listTables(executor)
    const applicationTables = tables.filter((table) => table !== MIGRATIONS_TABLE)

    if (applicationTables.length === 0) {
      console.log("[den-db] empty database detected; applying current schema snapshot")
      await applyCurrentSchema(executor)
      await baselineCommittedMigrations(executor)
    } else if (!tables.includes(MIGRATIONS_TABLE)) {
      if (tables.includes("oauthResource")) {
        console.log("[den-db] existing current schema without migration ledger detected; recording baseline")
        await baselineCommittedMigrations(executor)
      } else {
        console.log("[den-db] legacy pre-OAuth schema without migration ledger detected; recording its safe baseline")
        await baselineCommittedMigrations(executor, migrationMillis(LEGACY_PRE_OAUTH_BASELINE_TAG))
      }
    } else {
      if (!tables.includes("oauthResource")) {
        await repairMissingOauthSchema(executor)
      }
      await reconcilePostOauthBaseline(executor)
    }
  } finally {
    await executor.close()
  }

  console.log("[den-db] running committed migrations")
  await runCommittedMigrations()

  console.log("[den-db] ensuring schema repairs")
  const repairExecutor = await createExecutor()
  try {
    await ensureSchemaRepairs(repairExecutor)
  } finally {
    await repairExecutor.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  bootstrapDenDb().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
