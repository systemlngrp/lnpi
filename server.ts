import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());

// Database connection pool
let pool: mysql.Pool | null = null;

function normalizeWorkflowStatus(tableName: string, row: any) {
  const normalized = { ...row };
  const currentStatus = typeof normalized.status === "string" ? normalized.status.trim() : normalized.status;

  if (currentStatus) {
    normalized.status = currentStatus;
    return normalized;
  }

  if (tableName === "material_in") {
    if (normalized.tallyTimestamp) normalized.status = "Completed";
    else if (normalized.mdTimestamp) normalized.status = "Pending Tally";
    else if (normalized.accTimestamp) normalized.status = "Pending MD";
    else if (normalized.phTimestamp) normalized.status = "Pending Accounts";
    else normalized.status = "Pending PH";
    return normalized;
  }

  if (tableName === "productions" || tableName === "consumptions") {
    if (normalized.tallyTimestamp) normalized.status = "Completed";
    else if (normalized.phTimestamp) normalized.status = "Pending Tally";
    else normalized.status = "Pending PH";
  }

  return normalized;
}

async function getPool() {
  if (pool) return pool;
  
  const clean = (val: string | undefined) => val?.trim().replace(/^["']|["']$/g, '');
  
  const host = clean(process.env.DB_HOST);
  const user = clean(process.env.DB_USER);
  const password = clean(process.env.DB_PASSWORD);
  const database = clean(process.env.DB_NAME);
  const port = parseInt(clean(process.env.DB_PORT) || "3306");

  if (!host || !user || !database) {
    const missing = [];
    if (!host) missing.push("DB_HOST");
    if (!user) missing.push("DB_USER");
    if (!database) missing.push("DB_NAME");
    console.warn(`[DB] Initialization skipped. Missing env vars: ${missing.join(", ")}`);
    console.warn("[DB] Please set these in Settings -> Secrets.");
    return null;
  }

  console.log(`[DB] Attempting connection to ${host}:${port} (DB: ${database}, User: ${user})`);

  const config: mysql.PoolOptions = {
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
    queueLimit: 0,
    connectTimeout: 10000, // 10 seconds timeout
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };

  pool = mysql.createPool(config);

  // Add error handler to the pool to prevent it from crashing the process
  (pool as any).on('error', (err: any) => {
    console.error('[DB] Unexpected error on idle client', err);
    if (err && (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET')) {
      console.warn('[DB] Pool connection closed, will reconnect on next request');
      pool = null; // Reset pool so it gets recreated
    }
  });

  return pool;
}

// Health check endpoint to verify DB status
app.get("/api/db-status", async (req, res) => {
  const db = await getPool();
  if (!db) {
    return res.json({ 
      connected: false, 
      error: "Credentials missing. Set DB_HOST, DB_USER, DB_NAME, DB_PASSWORD in Settings." 
    });
  }
  try {
    // Try to query with a small retry if it fails due to connection issues
    let rows;
    try {
      [rows] = await db.query("SELECT 1 as connected");
    } catch (queryError: any) {
      if (queryError.code === 'PROTOCOL_CONNECTION_LOST' || queryError.code === 'ECONNRESET') {
        console.warn(`[DB] Health check retry due to ${queryError.code}`);
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        const newDb = await getPool();
        if (!newDb) throw queryError;
        [rows] = await newDb.query("SELECT 1 as connected");
      } else {
        throw queryError;
      }
    }
    res.json({ connected: true, data: rows });
  } catch (error) {
    console.error("Database status check failed:", error);
    res.json({ 
      connected: false, 
      error: (error as Error).message,
      code: (error as any).code,
      hint: (error as any).code === 'ECONNREFUSED' ? "Connection refused. Check if the database host and port are correct and if remote access is allowed." : 
            (error as any).code === 'ER_ACCESS_DENIED_ERROR' ? "Access denied. Check your username and password." :
            (error as any).code === 'ENOTFOUND' ? "Database host not found. Check the hostname." :
            "Check your database credentials."
    });
  }
});

// Initialize tables with retry
async function initDb(retries = 5) {
  for (let i = 0; i < retries; i++) {
    const db = await getPool();
    const clean = (val: string | undefined) => val?.trim().replace(/^["']|["']$/g, "");
    const database = clean(process.env.DB_NAME);
    
    if (!db || !database) {
      if (i === retries - 1) console.warn("[DB] Skipping tables initialization (no credentials or database name)");
      return;
    }

    try {
      console.log(`[DB] Initializing tables (attempt ${i + 1}/${retries})...`);
      
      // Test connection
      await db.query("SELECT 1");

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`item_groups\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`items\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`groupId\` VARCHAR(36) NOT NULL,
          \`name\` VARCHAR(255) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`erp\` INT DEFAULT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`suppliers\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`orders\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`orderNo\` VARCHAR(100),
          \`orderDate\` VARCHAR(50) NOT NULL,
          \`companyId\` VARCHAR(36) NOT NULL,
          \`poNumber\` VARCHAR(100),
          \`erpCode\` VARCHAR(100),
          \`itemId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`rate\` DECIMAL(15,2),
          \`orderBy\` VARCHAR(255),
          \`poType\` VARCHAR(50),
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`orders_schedule\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`orderId\` VARCHAR(36) NOT NULL,
          \`scheduledDate\` VARCHAR(50) NOT NULL,
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`companies\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`contactPerson\` VARCHAR(255),
          \`contactNumber\` VARCHAR(50),
          \`email\` VARCHAR(255),
          \`address\` TEXT,
          \`district\` VARCHAR(255),
          \`state\` VARCHAR(255),
          \`gstNo\` VARCHAR(100),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_in\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`timestamp\` VARCHAR(255) NOT NULL,
          \`entryEmailId\` VARCHAR(255) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`invoiceNo\` VARCHAR(100),
          \`invDate\` VARCHAR(50),
          \`supplierId\` VARCHAR(36) NOT NULL,
          \`totalAmount\` DECIMAL(15, 2) NOT NULL,
          \`lines\` JSON NOT NULL,
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`mdTimestamp\` VARCHAR(255),
          \`mdEmailId\` VARCHAR(255),
          \`tallyTimestamp\` VARCHAR(255),
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`users\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`userId\` VARCHAR(100) NOT NULL UNIQUE,
          \`name\` VARCHAR(255) NOT NULL,
          \`mobile\` VARCHAR(20),
          \`email\` VARCHAR(255),
          \`password\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`productions\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`itemId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15, 2) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`tallyTimestamp\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`consumptions\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`itemId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15, 2) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`tallyTimestamp\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      console.log("[DB] Database tables initialized successfully.");
      
      // Ensure all tables have required columns if they were created with an older schema
      const migrations = [
        { table: "items", column: "groupId", type: "VARCHAR(36) NOT NULL" },
        { table: "items", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "items", column: "erp", type: "INT" },
        { table: "item_groups", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "suppliers", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "material_in", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_in", column: "timestamp", type: "VARCHAR(255) NOT NULL" },
        { table: "material_in", column: "entryEmailId", type: "VARCHAR(255) NOT NULL" },
        { table: "material_in", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "material_in", column: "invoiceNo", type: "VARCHAR(100)" },
        { table: "material_in", column: "invDate", type: "VARCHAR(50)" },
        { table: "material_in", column: "lines", type: "JSON NOT NULL" },
        { table: "material_in", column: "supplierId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_in", column: "totalAmount", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "material_in", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "mdTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "mdEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "productions", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "productions", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "productions", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "productions", column: "qty", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "productions", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "productions", column: "remarks", type: "TEXT" },
        { table: "productions", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "productions", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "consumptions", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "consumptions", column: "qty", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "consumptions", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "remarks", type: "TEXT" },
        { table: "consumptions", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "consumptions", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "users", column: "userId", type: "VARCHAR(100) NOT NULL" },
        { table: "users", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "users", column: "mobile", type: "VARCHAR(20)" },
        { table: "users", column: "email", type: "VARCHAR(255)" },
        { table: "users", column: "password", type: "VARCHAR(255)" },
        { table: "material_in", column: "accTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "accEmailId", type: "VARCHAR(255)" },
        { table: "productions", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "productions", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "consumptions", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "item_groups", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "item_groups", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "items", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "items", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "suppliers", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "suppliers", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "companies", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "companies", column: "contactPerson", type: "VARCHAR(255)" },
        { table: "companies", column: "contactNumber", type: "VARCHAR(50)" },
        { table: "companies", column: "email", type: "VARCHAR(255)" },
        { table: "companies", column: "address", type: "TEXT" },
        { table: "companies", column: "district", type: "VARCHAR(255)" },
        { table: "companies", column: "state", type: "VARCHAR(255)" },
        { table: "companies", column: "gstNo", type: "VARCHAR(100)" },
        { table: "material_in", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_in", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "users", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "users", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "orders", column: "orderDate", type: "VARCHAR(50) NOT NULL" },
        { table: "orders", column: "companyId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "orders", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "orders", column: "erpCode", type: "VARCHAR(100)" },
        { table: "orders", column: "poNumber", type: "VARCHAR(100)" },
        { table: "orders", column: "rate", type: "DECIMAL(15,2)" },
        { table: "orders", column: "poType", type: "VARCHAR(50)" },
        { table: "orders_schedule", column: "orderId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders_schedule", column: "scheduledDate", type: "VARCHAR(50) NOT NULL" },
        { table: "orders_schedule", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "productions", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "productions", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "consumptions", column: "updateTimestamp", type: "VARCHAR(255)" },
      ];

      for (const m of migrations) {
        try {
          // Check if column exists using information_schema
          const [columns] = await db.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [database, m.table, m.column]
          );
          
          if ((columns as any[]).length === 0) {
            console.log(`[DB] Adding missing column ${m.column} to table ${m.table}...`);
            await db.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.type}`);
          }
        } catch (err) {
          console.warn(`[DB] Could not ensure column ${m.column} in ${m.table}:`, (err as Error).message);
        }
      }
      
      return; // Success
    } catch (error) {
      console.error(`[DB] Initialization attempt ${i + 1} failed:`, (error as Error).message);
      if (i < retries - 1) {
        console.log("[DB] Retrying in 2 seconds...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error("[DB] All initialization attempts failed.");
      }
    }
  }
}

// Generic API wrapper for simple CRUD
const createHandlers = (tableName: string) => {
  return {
    getAll: async (req: express.Request, res: express.Response) => {
      const db = await getPool();
      if (!db) return res.status(500).json({ error: "DB connection not available" });
      try {
        console.log(`[DB] Fetching all from ${tableName}`);
        const [rows] = await db.query(`SELECT * FROM \`${tableName}\``);
        
        // Post-process rows to parse JSON columns
        const processedRows = (rows as any[]).map(row => {
          const newRow = normalizeWorkflowStatus(tableName, row);
          Object.keys(newRow).forEach(key => {
            if (key === 'lines' && typeof newRow[key] === 'string') {
              try {
                newRow[key] = JSON.parse(newRow[key]);
              } catch (e) {
                console.error(`Failed to parse JSON for column ${key} in table ${tableName}:`, e);
              }
            }
          });
          return newRow;
        });

        res.json(processedRows);
      } catch (error) {
        console.error(`[DB] Error fetching from ${tableName}:`, error);
        res.status(500).json({ error: (error as Error).message });
      }
    },
    upsert: async (req: express.Request, res: express.Response) => {
      const db = await getPool();
      if (!db) return res.status(500).json({ error: "DB connection not available" });
      const data = normalizeWorkflowStatus(tableName, req.body);
      try {
        // Auto-generate orderNo for orders when not provided
        if (tableName === 'orders') {
          try {
            if (!data.orderNo) {
              const dateStr = data.orderDate || new Date().toISOString().slice(0,10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${fyStart}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `${fyLabel}/%`;
              const [rows] = await db.query(`SELECT orderNo FROM \`orders\` WHERE orderNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(orderNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`, [likePattern]);
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastOrderNo = (rows as any[])[0].orderNo as string;
                const parts = lastOrderNo.split('/');
                const suffix = parts[1];
                lastNum = parseInt(suffix || '0', 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, '0');
              data.orderNo = `${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate orderNo:', (err as Error).message);
          }
        }

        console.log(`[DB] Upserting to ${tableName}`, { 
          id: data.id, 
          status: data.status,
          transactionNo: data.transactionNo || data.transaction_no 
        });
        
        const keys = Object.keys(data);
        // Stringify any objects or arrays for MySQL JSON columns
        const values = Object.values(data).map(v => 
          (typeof v === "object" && v !== null) ? JSON.stringify(v) : v
        );
        
        const placeholders = keys.map(() => "?").join(",");
        const columnNames = keys.map(k => `\`${k}\``).join(",");
        const updates = keys.map(k => `\`${k}\`=VALUES(\`${k}\`)`).join(",");
        
        const query = `INSERT INTO \`${tableName}\` (${columnNames}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
        
        console.log(`[DB] Upserting to ${tableName}`, { id: data.id });
        await db.query(query, values);
        res.json({ success: true });
      } catch (error) {
        console.error(`[DB] Error upserting to ${tableName}:`, error);
        res.status(500).json({ error: (error as Error).message });
      }
    },
    delete: async (req: express.Request, res: express.Response) => {
      const db = await getPool();
      if (!db) return res.status(500).json({ error: "DB connection not available" });
      const { id } = req.params;
      try {
        console.log(`[DB] Deleting from ${tableName}`, { id });
        await db.query(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
        res.json({ success: true });
      } catch (error) {
        console.error(`[DB] Error deleting from ${tableName}:`, error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  };
};

// Routes
const entities = ["item_groups", "items", "suppliers", "companies", "orders", "orders_schedule", "material_in", "users", "productions", "consumptions"];
entities.forEach(entity => {
  const handlers = createHandlers(entity);
  const route = `/api/${entity.replace(/_/g, "-")}`;
  app.get(route, handlers.getAll);
  app.post(route, handlers.upsert);
  app.delete(`${route}/:id`, handlers.delete);
});

// Special handler for Material In lines (since they are stored as JSON)
// The generic upsert should handle it if the client sends stringified JSON or if mysql2 handles it.
// mysql2 handles objects/arrays as JSON if specified in the query.

async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
