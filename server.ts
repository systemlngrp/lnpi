import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Ensure uploads directory exists
if (!fs.existsSync(path.join(process.cwd(), "uploads"))) {
  fs.mkdirSync(path.join(process.cwd(), "uploads"));
}

app.post("/api/upload-artwork", async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64 || !filename) {
    return res.status(400).json({ error: "Missing file data" });
  }

  try {
    const base64Data = base64.split(";base64,").pop();
    const extension = path.extname(filename);
    const newFilename = `${crypto.randomUUID()}${extension}`;
    const filePath = path.join(process.cwd(), "uploads", newFilename);

    fs.writeFileSync(filePath, base64Data, { encoding: "base64" });
    res.json({ filename: newFilename });
  } catch (error) {
    console.error("Upload failed:", error);
    res.status(500).json({ error: "Failed to save file" });
  }
});

// Database connection pool
let pool: mysql.Pool | null = null;

function hasWorkflowValue(value: any) {
  if (value === null || value === undefined) return false;
  const asString = String(value).trim();
  if (!asString) return false;
  const asNumber = Number(asString);
  return Number.isFinite(asNumber) ? asNumber > 0 : true;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-");
}

function normalizeOfficialIndiaText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNamesFromSection(section: string) {
  const names = new Set<string>();
  for (const match of section.matchAll(/([A-Za-z][A-Za-z.&/\-'\s]+?)\s*\(/g)) {
    const rawName = match[1].replace(/\s+/g, " ").trim();
    if (!rawName || rawName.length < 3) continue;
    if (/States and Capitals|Union Territories|About India/i.test(rawName)) continue;
    names.add(rawName);
  }
  return [...names];
}

function extractOfficialIndiaStates(html: string) {
  const normalizedText = normalizeOfficialIndiaText(html);
  const statesSectionMatch = normalizedText.match(/States and Capitals\s+(.*?)\s+Union Territories/i);
  const unionTerritoriesSectionMatch = normalizedText.match(/Union Territories\s+(.*?)\s+About India/i);
  const states = statesSectionMatch ? extractNamesFromSection(statesSectionMatch[1]) : [];
  const unionTerritories = unionTerritoriesSectionMatch ? extractNamesFromSection(unionTerritoriesSectionMatch[1]) : [];
  return [...new Set([...states, ...unionTerritories])];
}

async function ensureIndianStatesSeed(db: mysql.Pool) {
  const sourceUrls = [
    "https://knowindia.india.gov.in/states-uts/",
    "https://www.india.gov.in/explore-india/facts-of-india/states-ut-districts",
  ];

  let stateNames: string[] = [];
  for (const url of sourceUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "LNPI-ERP/1.0",
        },
      });
      if (!response.ok) continue;
      const html = await response.text();
      stateNames = extractOfficialIndiaStates(html);
      if (stateNames.length >= 36) break;
    } catch (error) {
      console.warn(`[DB] Failed to fetch states from ${url}:`, (error as Error).message);
    }
  }

  if (stateNames.length < 36) {
    console.warn("[DB] Official state import skipped because the source could not be parsed reliably.");
    return;
  }

  const timestamp = new Date().toISOString();
  for (const name of stateNames) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;

    const [existingRows] = await db.query(
      "SELECT id FROM `states` WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1",
      [trimmedName]
    );
    const existing = (existingRows as any[])[0];

    if (existing) {
      await db.query(
        "UPDATE `states` SET `name` = ?, `updateTimestamp` = ? WHERE `id` = ?",
        [trimmedName, timestamp, existing.id]
      );
      continue;
    }

    await db.query(
      "INSERT INTO `states` (`id`, `name`, `active`, `updatedBy`, `updateTimestamp`) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), trimmedName, "Yes", "System Seed", timestamp]
    );
  }

  console.log(`[DB] Seeded/verified ${stateNames.length} India states and union territories.`);
}

function normalizeWorkflowStatus(tableName: string, row: any) {
  const normalized = { ...row };
  const currentStatus = typeof normalized.status === "string" ? normalized.status.trim() : normalized.status;

  if (currentStatus && tableName !== "productions") {
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

  if (tableName === "productions") {
    if (currentStatus === "Completed" || normalized.tallyTimestamp) normalized.status = "Completed";
    else if (currentStatus === "Cancelled" || normalized.cancelTimestamp) normalized.status = "Cancelled";
    else if (currentStatus === "Pending Consumption" || currentStatus === "Pending FFG") normalized.status = currentStatus;
    else if (!normalized.phTimestamp) normalized.status = "Pending PH";
    else if (!hasWorkflowValue(normalized.actualPaperUsed)) normalized.status = "Pending Consumption";
    else if (!hasWorkflowValue(normalized.prodFromFFG)) normalized.status = "Pending FFG";
    else normalized.status = "Pending Tally";
    return normalized;
  }

  if (tableName === "consumptions") {
    if (normalized.tallyTimestamp) normalized.status = "Completed";
    else if (normalized.cancelTimestamp) normalized.status = "Cancelled";
    else if (normalized.phTimestamp) normalized.status = "Pending Tally";
    else normalized.status = "Pending PH";
    return normalized;
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
        CREATE TABLE IF NOT EXISTS \`material_groups\` (
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
          \`itemType\` VARCHAR(20) DEFAULT 'Others',
          \`typeName\` VARCHAR(255),
          \`customer\` VARCHAR(255),
          \`openLength\` DECIMAL(15,2),
          \`openWidth\` DECIMAL(15,2),
          \`opening\` DECIMAL(15,2) DEFAULT 0,
          \`gstRate\` DECIMAL(5,2) DEFAULT 18.00,
          \`noOfParts\` INT,
          \`ups\` INT,
          \`length\` DECIMAL(15,2),
          \`breadth\` DECIMAL(15,2),
          \`height\` DECIMAL(15,2),
          \`ply\` INT,
          \`flute\` VARCHAR(50),
          \`takeUpFactor\` DECIMAL(15,5),
          \`part\` VARCHAR(255),
          \`dieCutUps\` INT,
          \`topPaperShade\` VARCHAR(255),
          \`plateWeight\` DECIMAL(15,5),
          \`gsmLeastCost\` DECIMAL(15,2),
          \`l1\` DECIMAL(15,2),
          \`f1\` DECIMAL(15,2),
          \`l2\` DECIMAL(15,2),
          \`f2\` DECIMAL(15,2),
          \`l3\` DECIMAL(15,2),
          \`f3\` DECIMAL(15,2),
          \`b3\` DECIMAL(15,2),
          \`backingPaperShade\` VARCHAR(255),
          \`printingColour1\` VARCHAR(255),
          \`printingColour2\` VARCHAR(255),
          \`lOd\` DECIMAL(15,2),
          \`wOd\` DECIMAL(15,2),
          \`hOd\` DECIMAL(15,2),
          \`flap\` DECIMAL(15,2),
          \`deckleSize\` DECIMAL(15,2),
          \`cuttingSize\` DECIMAL(15,2),
          \`rate\` DECIMAL(15,2),
          \`artwork\` LONGTEXT,
          \`spec\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`materials\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`type\` VARCHAR(50) NOT NULL,
          \`erpCode\` VARCHAR(100),
          \`name\` VARCHAR(255) NOT NULL,
          \`uom\` VARCHAR(50),
          \`materialGroupId\` VARCHAR(36),
          \`size\` DECIMAL(15,2),
          \`gsm\` DECIMAL(15,2),
          \`bf\` DECIMAL(15,2),
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`indents\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`requestedBy\` VARCHAR(255) NOT NULL,
          \`requisitionDate\` VARCHAR(50) NOT NULL,
          \`requiredDate\` VARCHAR(50) NOT NULL,
          \`indentType\` VARCHAR(50) NOT NULL,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending',
          \`approvedTimestamp\` VARCHAR(255),
          \`approvedBy\` VARCHAR(255),
          \`completedTimestamp\` VARCHAR(255),
          \`completedBy\` VARCHAR(255),
          \`rejectedTimestamp\` VARCHAR(255),
          \`rejectedBy\` VARCHAR(255),
          \`rejectedRemarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`indent_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`indentId\` VARCHAR(36) NOT NULL,
          \`erpCode\` VARCHAR(100),
          \`materialId\` VARCHAR(36) NOT NULL,
          \`uom\` VARCHAR(50),
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`orderedQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`cancelledQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`balanceQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`purchase_orders\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`poNo\` VARCHAR(100) NOT NULL,
          \`indentId\` VARCHAR(36) NOT NULL,
          \`supplierId\` VARCHAR(36) NOT NULL,
          \`poDate\` VARCHAR(50) NOT NULL,
          \`requiredDate\` VARCHAR(50) NOT NULL,
          \`totalQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`totalAmount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending Approval',
          \`approvedBy\` VARCHAR(255),
          \`approvedTimestamp\` VARCHAR(255),
          \`rejectedBy\` VARCHAR(255),
          \`rejectedTimestamp\` VARCHAR(255),
          \`rejectedRemarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`purchase_order_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`purchaseOrderId\` VARCHAR(36) NOT NULL,
          \`indentLineId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`erpCode\` VARCHAR(100),
          \`uom\` VARCHAR(50),
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`rate\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`gate_entries\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`gateEntryNo\` VARCHAR(100),
          \`date\` VARCHAR(50) NOT NULL,
          \`supplierId\` VARCHAR(36) NOT NULL,
          \`invoiceNo\` VARCHAR(100) NOT NULL,
          \`invoiceValue\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`truckNo\` VARCHAR(100) NOT NULL,
          \`mrrId\` VARCHAR(36),
          \`mrrDate\` VARCHAR(50),
          \`mrrNo\` VARCHAR(100),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`gate_entry_photos\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`gateEntryId\` VARCHAR(36) NOT NULL,
          \`photo\` VARCHAR(255) NOT NULL,
          \`slotNo\` INT NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`suppliers\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`contactPerson\` VARCHAR(255),
          \`contactNumber\` VARCHAR(50),
          \`email\` VARCHAR(255),
          \`gstNo\` VARCHAR(100),
          \`stateId\` VARCHAR(36),
          \`district\` VARCHAR(255),
          \`pinCode\` VARCHAR(20),
          \`address\` TEXT,
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`states\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`color_masters\` (
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
          \`producedQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`canceledQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
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
          \`deviationAllowed\` DECIMAL(10,2),
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
          \`scheduleId\` VARCHAR(36),
          \`itemId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15, 2) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`noOfParts\` INT,
          \`ups\` INT,
          \`length\` DECIMAL(15,2),
          \`breadth\` DECIMAL(15,2),
          \`height\` DECIMAL(15,2),
          \`reelAsPerCalc\` DECIMAL(15,2),
          \`noOfUpsInCuttingForPlates\` DECIMAL(15,2),
          \`reelActualWithTrimming\` DECIMAL(15,2),
          \`cuttingWithTrimming\` DECIMAL(15,2),
          \`ply\` INT,
          \`idToOd\` VARCHAR(255),
          \`flute\` VARCHAR(255),
          \`takeUpFactor\` DECIMAL(15,5),
          \`top\` DECIMAL(15,2),
          \`l1\` DECIMAL(15,2),
          \`f1\` DECIMAL(15,2),
          \`l2\` DECIMAL(15,2),
          \`f2\` DECIMAL(15,2),
          \`l3\` DECIMAL(15,2),
          \`gsm\` DECIMAL(15,2),
          \`color1\` VARCHAR(255),
          \`color2\` VARCHAR(255),
          \`printingColor\` VARCHAR(255),
          \`paperRequiredNos\` DECIMAL(15,2),
          \`topPaperWeightKg\` DECIMAL(15,5),
          \`linerWeightKg\` DECIMAL(15,5),
          \`totalJobWeight\` DECIMAL(15,5),
          \`sheetWeight\` DECIMAL(15,5),
          \`plateWeight\` DECIMAL(15,5),
          \`gsmLeastCost\` DECIMAL(15,2),
          \`totalPaperWeight\` DECIMAL(15,5),
          \`rate\` DECIMAL(15,2),
          \`totalWeightOfSet\` DECIMAL(15,5),
          \`realizationPerKg\` DECIMAL(15,2),
          \`companyName\` VARCHAR(255),
          \`actualPaperUsed\` DECIMAL(15,5),
          \`avgWeight\` DECIMAL(15,5),
          \`prodFromSheetPlant\` DECIMAL(15,2),
          \`prodFromFFG\` DECIMAL(15,2),
          \`wastage\` DECIMAL(15,2),
          \`productionInMeter\` DECIMAL(15,2),
          \`plannedProductionInMeter\` DECIMAL(15,2),
          \`leastGsm\` DECIMAL(15,5),
          \`fluteBatches\` TEXT,
          \`erpCodeReel\` VARCHAR(255),
          \`lineRequiredNos\` DECIMAL(15,2),
          \`jobCardNo\` VARCHAR(255),
          \`erpCode\` VARCHAR(255),
          \`year\` INT,
          \`month\` VARCHAR(50),
          \`idToOd17\` DECIMAL(15,2),
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`tallyTimestamp\` VARCHAR(255),
          \`cancelTimestamp\` VARCHAR(255),
          \`cancelEmailId\` VARCHAR(255),
          \`cancelRemarks\` TEXT,
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
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`tallyTimestamp\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255),
          \`productionId\` VARCHAR(36),
          \`jobCardNo\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`sample_requests\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`timestamp\` VARCHAR(255) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`itemId\` VARCHAR(36) NOT NULL,
          \`itemName\` VARCHAR(255) NOT NULL,
          \`erp\` VARCHAR(100),
          \`plannedQuantity\` DECIMAL(15,2) NOT NULL,
          \`jobCardNo\` VARCHAR(255),
          \`cancelTimestamp\` VARCHAR(255),
          \`cancelBy\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`trucks\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`truckNo\` VARCHAR(50) NOT NULL,
          \`driverName\` VARCHAR(255),
          \`mobileNo\` VARCHAR(20),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`dispatch_plans\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`scheduleId\` VARCHAR(36) NOT NULL,
          \`orderId\` VARCHAR(36) NOT NULL,
          \`truckId\` VARCHAR(36) NOT NULL,
          \`plannedQty\` DECIMAL(15,2) NOT NULL,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Planned',
          \`date\` VARCHAR(50) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`loading_slips\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`slipNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`truckId\` VARCHAR(36) NOT NULL,
          \`lines\` JSON NOT NULL,
          \`invoiceId\` VARCHAR(36),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`invoices\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`invoiceNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`companyId\` VARCHAR(36) NOT NULL,
          \`gstRate\` DECIMAL(5,2) NOT NULL,
          \`totalBeforeGst\` DECIMAL(15,2) NOT NULL,
          \`cgst\` DECIMAL(15,2) NOT NULL,
          \`sgst\` DECIMAL(15,2) NOT NULL,
          \`igst\` DECIMAL(15,2) NOT NULL,
          \`totalAfterGst\` DECIMAL(15,2) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`invoice_line_items\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`invoiceId\` VARCHAR(36) NOT NULL,
          \`loadingSlipId\` VARCHAR(36) NOT NULL,
          \`itemId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`rate\` DECIMAL(15,2) NOT NULL,
          \`amount\` DECIMAL(15,2) NOT NULL,
          \`gstRate\` DECIMAL(5,2) NOT NULL DEFAULT 18.00,
          \`cgst\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`sgst\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`igst\` DECIMAL(15,2) NOT NULL DEFAULT 0
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`settings\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`reelAsPerCalculation\` TEXT,
          \`flapAsPerCalculation\` TEXT,
          \`cuttingSizeAsPerCalculation\` TEXT,
          \`gsmAsPerCalculation\` TEXT,
          \`productionFormVisibleColumns\` LONGTEXT,
          \`organizationName\` VARCHAR(255),
          \`organizationAddress\` TEXT,
          \`organizationGstDetails\` TEXT,
          \`organizationLogo\` VARCHAR(255),
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
        { table: "items", column: "itemType", type: "VARCHAR(20) DEFAULT 'Others'" },
        { table: "items", column: "typeName", type: "VARCHAR(255)" },
        { table: "items", column: "customer", type: "VARCHAR(255)" },
        { table: "items", column: "openLength", type: "DECIMAL(15,2)" },
        { table: "items", column: "openWidth", type: "DECIMAL(15,2)" },
        { table: "items", column: "opening", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "item_groups", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "material_groups", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "materials", column: "type", type: "VARCHAR(50) NOT NULL" },
        { table: "materials", column: "erpCode", type: "VARCHAR(100)" },
        { table: "materials", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "materials", column: "uom", type: "VARCHAR(50)" },
        { table: "materials", column: "materialGroupId", type: "VARCHAR(36)" },
        { table: "materials", column: "size", type: "DECIMAL(15,2)" },
        { table: "materials", column: "gsm", type: "DECIMAL(15,2)" },
        { table: "materials", column: "bf", type: "DECIMAL(15,2)" },
        { table: "materials", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "indents", column: "requestedBy", type: "VARCHAR(255) NOT NULL" },
        { table: "indents", column: "requisitionDate", type: "VARCHAR(50) NOT NULL" },
        { table: "indents", column: "requiredDate", type: "VARCHAR(50) NOT NULL" },
        { table: "indents", column: "indentType", type: "VARCHAR(50) NOT NULL" },
        { table: "indents", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending'" },
        { table: "indents", column: "totalIndentQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indents", column: "totalOrderedQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indents", column: "totalCancelledQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indents", column: "totalBalanceQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indents", column: "approvedTimestamp", type: "VARCHAR(255)" },
        { table: "indents", column: "approvedBy", type: "VARCHAR(255)" },
        { table: "indents", column: "completedTimestamp", type: "VARCHAR(255)" },
        { table: "indents", column: "completedBy", type: "VARCHAR(255)" },
        { table: "indents", column: "rejectedTimestamp", type: "VARCHAR(255)" },
        { table: "indents", column: "rejectedBy", type: "VARCHAR(255)" },
        { table: "indents", column: "rejectedRemarks", type: "TEXT" },
        { table: "indents", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "indents", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "indent_lines", column: "indentId", type: "VARCHAR(36) NOT NULL" },
        { table: "indent_lines", column: "erpCode", type: "VARCHAR(100)" },
        { table: "indent_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "indent_lines", column: "uom", type: "VARCHAR(50)" },
        { table: "indent_lines", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "indent_lines", column: "orderedQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "cancelledQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "balanceQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "indent_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "poNo", type: "VARCHAR(100) NOT NULL" },
        { table: "purchase_orders", column: "indentId", type: "VARCHAR(36) NOT NULL" },
        { table: "purchase_orders", column: "supplierId", type: "VARCHAR(36) NOT NULL" },
        { table: "purchase_orders", column: "poDate", type: "VARCHAR(50) NOT NULL" },
        { table: "purchase_orders", column: "requiredDate", type: "VARCHAR(50) NOT NULL" },
        { table: "purchase_orders", column: "totalQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "purchase_orders", column: "totalAmount", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "purchase_orders", column: "remarks", type: "TEXT" },
        { table: "purchase_orders", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending Approval'" },
        { table: "purchase_orders", column: "approvedBy", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "approvedTimestamp", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "rejectedBy", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "rejectedTimestamp", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "rejectedRemarks", type: "TEXT" },
        { table: "purchase_orders", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "purchase_order_lines", column: "purchaseOrderId", type: "VARCHAR(36) NOT NULL" },
        { table: "purchase_order_lines", column: "indentLineId", type: "VARCHAR(36) NOT NULL" },
        { table: "purchase_order_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "purchase_order_lines", column: "erpCode", type: "VARCHAR(100)" },
        { table: "purchase_order_lines", column: "uom", type: "VARCHAR(50)" },
        { table: "purchase_order_lines", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "purchase_order_lines", column: "rate", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "purchase_order_lines", column: "amount", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "purchase_order_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "purchase_order_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "gate_entries", column: "gateEntryNo", type: "VARCHAR(100)" },
        { table: "gate_entries", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "gate_entries", column: "supplierId", type: "VARCHAR(36) NOT NULL" },
        { table: "gate_entries", column: "invoiceNo", type: "VARCHAR(100) NOT NULL" },
        { table: "gate_entries", column: "invoiceValue", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "gate_entries", column: "truckNo", type: "VARCHAR(100) NOT NULL" },
        { table: "gate_entries", column: "mrrId", type: "VARCHAR(36)" },
        { table: "gate_entries", column: "mrrDate", type: "VARCHAR(50)" },
        { table: "gate_entries", column: "mrrNo", type: "VARCHAR(100)" },
        { table: "gate_entries", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "gate_entries", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "gate_entry_photos", column: "gateEntryId", type: "VARCHAR(36) NOT NULL" },
        { table: "gate_entry_photos", column: "photo", type: "VARCHAR(255) NOT NULL" },
        { table: "gate_entry_photos", column: "slotNo", type: "INT NOT NULL" },
        { table: "gate_entry_photos", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "gate_entry_photos", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "suppliers", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "suppliers", column: "contactPerson", type: "VARCHAR(255)" },
        { table: "suppliers", column: "contactNumber", type: "VARCHAR(50)" },
        { table: "suppliers", column: "email", type: "VARCHAR(255)" },
        { table: "suppliers", column: "gstNo", type: "VARCHAR(100)" },
        { table: "suppliers", column: "stateId", type: "VARCHAR(36)" },
        { table: "suppliers", column: "district", type: "VARCHAR(255)" },
        { table: "suppliers", column: "pinCode", type: "VARCHAR(20)" },
        { table: "suppliers", column: "address", type: "TEXT" },
        { table: "suppliers", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "states", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "states", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "color_masters", column: "name", type: "VARCHAR(255) NOT NULL" },
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
        { table: "productions", column: "cancelTimestamp", type: "VARCHAR(255)" },
        { table: "productions", column: "cancelEmailId", type: "VARCHAR(255)" },
        { table: "productions", column: "cancelRemarks", type: "TEXT" },
        { table: "consumptions", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "consumptions", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "consumptions", column: "qty", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "consumptions", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "remarks", type: "TEXT" },
        { table: "consumptions", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "consumptions", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "timestamp", type: "VARCHAR(255) NOT NULL" },
        { table: "sample_requests", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "sample_requests", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "sample_requests", column: "itemName", type: "VARCHAR(255) NOT NULL" },
        { table: "sample_requests", column: "erp", type: "VARCHAR(100)" },
        { table: "sample_requests", column: "plannedQuantity", type: "DECIMAL(15,2) NOT NULL" },
        { table: "sample_requests", column: "jobCardNo", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "cancelTimestamp", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "cancelBy", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "users", column: "userId", type: "VARCHAR(100) NOT NULL" },
        { table: "users", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "users", column: "mobile", type: "VARCHAR(20)" },
        { table: "users", column: "email", type: "VARCHAR(255)" },
        { table: "users", column: "password", type: "VARCHAR(255)" },
        { table: "companies", column: "deviationAllowed", type: "DECIMAL(10,2)" },
        { table: "material_in", column: "accTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "accEmailId", type: "VARCHAR(255)" },
        { table: "productions", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "productions", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "productions", column: "noOfParts", type: "INT" },
        { table: "productions", column: "ups", type: "INT" },
        { table: "productions", column: "length", type: "DECIMAL(15,2)" },        { table: "productions", column: "breadth", type: "DECIMAL(15,2)" },
        { table: "productions", column: "height", type: "DECIMAL(15,2)" },
        { table: "productions", column: "reelAsPerCalc", type: "DECIMAL(15,2)" },
        { table: "productions", column: "noOfUpsInCuttingForPlates", type: "DECIMAL(15,2)" },
        { table: "productions", column: "reelActualWithTrimming", type: "DECIMAL(15,2)" },
        { table: "productions", column: "cuttingWithTrimming", type: "DECIMAL(15,2)" },
        { table: "productions", column: "ply", type: "INT" },
        { table: "productions", column: "idToOd", type: "VARCHAR(255)" },
        { table: "productions", column: "flute", type: "VARCHAR(255)" },
        { table: "productions", column: "takeUpFactor", type: "DECIMAL(15,5)" },
        { table: "productions", column: "top", type: "DECIMAL(15,2)" },
        { table: "productions", column: "l1", type: "DECIMAL(15,2)" },
        { table: "productions", column: "f1", type: "DECIMAL(15,2)" },
        { table: "productions", column: "l2", type: "DECIMAL(15,2)" },
        { table: "productions", column: "f2", type: "DECIMAL(15,2)" },
        { table: "productions", column: "l3", type: "DECIMAL(15,2)" },
        { table: "productions", column: "gsm", type: "DECIMAL(15,2)" },
        { table: "productions", column: "color1", type: "VARCHAR(255)" },
        { table: "productions", column: "color2", type: "VARCHAR(255)" },
        { table: "productions", column: "printingColor", type: "VARCHAR(255)" },
        { table: "productions", column: "paperRequiredNos", type: "DECIMAL(15,2)" },
        { table: "productions", column: "topPaperWeightKg", type: "DECIMAL(15,5)" },
        { table: "productions", column: "linerWeightKg", type: "DECIMAL(15,5)" },
        { table: "productions", column: "totalJobWeight", type: "DECIMAL(15,5)" },
        { table: "productions", column: "sheetWeight", type: "DECIMAL(15,5)" },
        { table: "productions", column: "plateWeight", type: "DECIMAL(15,5)" },
        { table: "productions", column: "gsmLeastCost", type: "DECIMAL(15,2)" },
        { table: "productions", column: "totalPaperWeight", type: "DECIMAL(15,5)" },
        { table: "productions", column: "rate", type: "DECIMAL(15,2)" },
        { table: "productions", column: "totalWeightOfSet", type: "DECIMAL(15,5)" },
        { table: "productions", column: "realizationPerKg", type: "DECIMAL(15,2)" },
        { table: "productions", column: "companyName", type: "VARCHAR(255)" },
        { table: "productions", column: "actualPaperUsed", type: "DECIMAL(15,5)" },
        { table: "productions", column: "avgWeight", type: "DECIMAL(15,5)" },
        { table: "productions", column: "prodFromSheetPlant", type: "DECIMAL(15,2)" },
        { table: "productions", column: "prodFromFFG", type: "DECIMAL(15,2)" },
        { table: "productions", column: "wastage", type: "DECIMAL(15,2)" },
        { table: "productions", column: "productionInMeter", type: "DECIMAL(15,2)" },
        { table: "productions", column: "plannedProductionInMeter", type: "DECIMAL(15,2)" },
        { table: "productions", column: "leastGsm", type: "DECIMAL(15,5)" },
        { table: "productions", column: "fluteBatches", type: "TEXT" },
        { table: "productions", column: "erpCodeReel", type: "VARCHAR(255)" },
        { table: "productions", column: "lineRequiredNos", type: "DECIMAL(15,2)" },
        { table: "productions", column: "jobCardNo", type: "VARCHAR(255)" },
        { table: "productions", column: "erpCode", type: "VARCHAR(255)" },
        { table: "productions", column: "year", type: "INT" },
        { table: "productions", column: "month", type: "VARCHAR(50)" },
        { table: "productions", column: "idToOd17", type: "DECIMAL(15,2)" },
        { table: "consumptions", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "item_groups", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "item_groups", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_groups", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_groups", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "materials", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "materials", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "items", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "items", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "suppliers", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "suppliers", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "states", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "states", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "color_masters", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "color_masters", column: "updateTimestamp", type: "VARCHAR(255)" },
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
        { table: "orders_schedule", column: "producedQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "orders_schedule", column: "canceledQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "productions", column: "scheduleId", type: "VARCHAR(36)" },
        { table: "productions", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "productions", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "consumptions", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "consumptions", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "consumptions", column: "productionId", type: "VARCHAR(36)" },
        { table: "consumptions", column: "jobCardNo", type: "VARCHAR(255)" },
        { table: "trucks", column: "truckNo", type: "VARCHAR(50) NOT NULL" },
        { table: "trucks", column: "driverName", type: "VARCHAR(255)" },
        { table: "trucks", column: "mobileNo", type: "VARCHAR(20)" },
        { table: "trucks", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "trucks", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "dispatch_plans", column: "scheduleId", type: "VARCHAR(36) NOT NULL" },
        { table: "dispatch_plans", column: "orderId", type: "VARCHAR(36) NOT NULL" },
        { table: "dispatch_plans", column: "truckId", type: "VARCHAR(36) NOT NULL" },
        { table: "dispatch_plans", column: "plannedQty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "dispatch_plans", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Planned'" },
        { table: "dispatch_plans", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "dispatch_plans", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "dispatch_plans", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "dispatch_plans", column: "loadedQty", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "dispatch_plans", column: "canceledQty", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "loading_slips", column: "slipNo", type: "VARCHAR(100) NOT NULL" },
        { table: "loading_slips", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "loading_slips", column: "truckId", type: "VARCHAR(36) NOT NULL" },
        { table: "loading_slips", column: "lines", type: "JSON NOT NULL" },
        { table: "loading_slips", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "loading_slips", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "loading_slips", column: "invoiceId", type: "VARCHAR(36)" },
        { table: "invoices", column: "invoiceNo", type: "VARCHAR(100) NOT NULL" },
        { table: "invoices", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "invoices", column: "companyId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoices", column: "gstRate", type: "DECIMAL(5,2) NOT NULL" },
        { table: "invoices", column: "totalBeforeGst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "cgst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "sgst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "igst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "totalAfterGst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "invoices", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "invoice_line_items", column: "invoiceId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "loadingSlipId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoice_line_items", column: "rate", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoice_line_items", column: "amount", type: "DECIMAL(15,2) NOT NULL" },
        { table: "items", column: "gstRate", type: "DECIMAL(5,2) DEFAULT 18.00" },
        { table: "items", column: "noOfParts", type: "INT" },
        { table: "items", column: "ups", type: "INT" },
        { table: "items", column: "length", type: "DECIMAL(15,2)" },
        { table: "items", column: "breadth", type: "DECIMAL(15,2)" },
        { table: "items", column: "height", type: "DECIMAL(15,2)" },
        { table: "items", column: "ply", type: "INT" },
        { table: "items", column: "flute", type: "VARCHAR(50)" },
        { table: "items", column: "takeUpFactor", type: "DECIMAL(15,5)" },
        { table: "items", column: "part", type: "VARCHAR(255)" },
        { table: "items", column: "dieCutUps", type: "INT" },
        { table: "items", column: "topPaperShade", type: "VARCHAR(255)" },
        { table: "items", column: "plateWeight", type: "DECIMAL(15,5)" },
        { table: "items", column: "gsmLeastCost", type: "DECIMAL(15,2)" },
        { table: "items", column: "l1", type: "DECIMAL(15,2)" },
        { table: "items", column: "f1", type: "DECIMAL(15,2)" },
        { table: "items", column: "l2", type: "DECIMAL(15,2)" },
        { table: "items", column: "f2", type: "DECIMAL(15,2)" },
        { table: "items", column: "l3", type: "DECIMAL(15,2)" },
        { table: "items", column: "f3", type: "DECIMAL(15,2)" },
        { table: "items", column: "b3", type: "DECIMAL(15,2)" },
        { table: "items", column: "backingPaperShade", type: "VARCHAR(255)" },
        { table: "items", column: "printingColour1", type: "VARCHAR(255)" },
        { table: "items", column: "printingColour2", type: "VARCHAR(255)" },
        { table: "items", column: "lOd", type: "DECIMAL(15,2)" },
        { table: "items", column: "wOd", type: "DECIMAL(15,2)" },
        { table: "items", column: "hOd", type: "DECIMAL(15,2)" },
        { table: "items", column: "flap", type: "DECIMAL(15,2)" },
        { table: "items", column: "deckleSize", type: "DECIMAL(15,2)" },
        { table: "items", column: "cuttingSize", type: "DECIMAL(15,2)" },
        { table: "items", column: "rate", type: "DECIMAL(15,2)" },
        { table: "items", column: "artwork", type: "LONGTEXT" },
        { table: "items", column: "spec", type: "TEXT" },
        { table: "invoice_line_items", column: "gstRate", type: "DECIMAL(5,2) NOT NULL DEFAULT 18.00" },
        { table: "invoice_line_items", column: "cgst", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "invoice_line_items", column: "sgst", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "invoice_line_items", column: "igst", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "settings", column: "reelAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "flapAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "cuttingSizeAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "gsmAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "productionFormVisibleColumns", type: "LONGTEXT" },
        { table: "settings", column: "organizationName", type: "VARCHAR(255)" },
        { table: "settings", column: "organizationAddress", type: "TEXT" },
        { table: "settings", column: "organizationGstDetails", type: "TEXT" },
        { table: "settings", column: "organizationLogo", type: "VARCHAR(255)" },
        { table: "settings", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "settings", column: "updateTimestamp", type: "VARCHAR(255)" },
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

      try {
        const [oldLeastSheetWeight] = await db.query(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
          [database, "productions", "leastSheetWeight"]
        );
        const [newLeastGsm] = await db.query(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
          [database, "productions", "leastGsm"]
        );

        if ((oldLeastSheetWeight as any[]).length > 0 && (newLeastGsm as any[]).length === 0) {
          console.log("[DB] Renaming productions.leastSheetWeight to leastGsm...");
          await db.query("ALTER TABLE `productions` CHANGE COLUMN `leastSheetWeight` `leastGsm` DECIMAL(15,5)");
        }
      } catch (err) {
        console.warn("[DB] Could not rename leastSheetWeight to leastGsm:", (err as Error).message);
      }

      const dropMigrations = [
        { table: "productions", column: "realizationApprovalStatus" },
        { table: "productions", column: "wastageApproval" },
      ];

      for (const m of dropMigrations) {
        try {
          const [columns] = await db.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [database, m.table, m.column]
          );

          if ((columns as any[]).length > 0) {
            console.log(`[DB] Dropping deprecated column ${m.column} from table ${m.table}...`);
            await db.query(`ALTER TABLE \`${m.table}\` DROP COLUMN \`${m.column}\``);
          }
        } catch (err) {
          console.warn(`[DB] Could not drop column ${m.column} from ${m.table}:`, (err as Error).message);
        }
      }

      try {
        await ensureIndianStatesSeed(db);
      } catch (err) {
        console.warn("[DB] Could not seed official India states:", (err as Error).message);
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
        let rows;

        if (tableName === "items") {
          [rows] = await db.query(`
            SELECT
              i.*,
              CAST(COALESCE(i.opening, 0) AS DECIMAL(15,2)) AS opening,
              CAST(CASE WHEN i.itemType = 'FG' THEN COALESCE(r.receipt, 0) ELSE 0 END AS DECIMAL(15,2)) AS receipt,
              CAST(COALESCE(p.production, 0) AS DECIMAL(15,2)) AS production,
              CAST(COALESCE(inv.invoiced, 0) AS DECIMAL(15,2)) AS invoiced,
              CAST(
                COALESCE(i.opening, 0)
                + (CASE WHEN i.itemType = 'FG' THEN COALESCE(r.receipt, 0) ELSE 0 END)
                + COALESCE(p.production, 0)
                - COALESCE(inv.invoiced, 0)
              AS DECIMAL(15,2)) AS balance
            FROM \`items\` i
            LEFT JOIN (
              SELECT
                jt.itemId,
                SUM(COALESCE(jt.qty, 0)) AS receipt
              FROM \`material_in\` mi
              JOIN JSON_TABLE(
                mi.lines,
                '$[*]' COLUMNS (
                  itemId VARCHAR(36) PATH '$.itemId',
                  qty DECIMAL(15,2) PATH '$.qty'
                )
              ) jt
              GROUP BY jt.itemId
            ) r ON r.itemId COLLATE utf8mb4_unicode_ci = i.id COLLATE utf8mb4_unicode_ci
            LEFT JOIN (
              SELECT
                itemId,
                SUM(COALESCE(prodFromFFG, 0)) AS production
              FROM \`productions\`
              WHERE status <> 'Cancelled' OR status IS NULL
              GROUP BY itemId
            ) p ON p.itemId COLLATE utf8mb4_unicode_ci = i.id COLLATE utf8mb4_unicode_ci
            LEFT JOIN (
              SELECT
                itemId,
                SUM(COALESCE(qty, 0)) AS invoiced
              FROM \`invoice_line_items\`
              GROUP BY itemId
            ) inv ON inv.itemId COLLATE utf8mb4_unicode_ci = i.id COLLATE utf8mb4_unicode_ci
          `);
        } else {
          [rows] = await db.query(`SELECT * FROM \`${tableName}\``);
        }
        
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
        if (tableName === "items") {
          delete data.receipt;
          delete data.production;
          delete data.invoiced;
          delete data.balance;
        }

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

        // Auto-generate slipNo for loading_slips when not provided
        if (tableName === 'loading_slips') {
          try {
            if (!data.slipNo) {
              const dateStr = data.date || new Date().toISOString().slice(0,10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${fyStart}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `LS/${fyLabel}/%`;
              const [rows] = await db.query(`SELECT slipNo FROM \`loading_slips\` WHERE slipNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(slipNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`, [likePattern]);
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastSlipNo = (rows as any[])[0].slipNo as string;
                const parts = lastSlipNo.split('/');
                const suffix = parts[parts.length - 1];
                lastNum = parseInt(suffix || '0', 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, '0');
              data.slipNo = `LS/${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate slipNo:', (err as Error).message);
          }
        }

        // Auto-generate invoiceNo for invoices when not provided
        if (tableName === 'invoices') {
          try {
            if (!data.invoiceNo) {
              const dateStr = data.date || new Date().toISOString().slice(0,10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${fyStart}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `INV/${fyLabel}/%`;
              const [rows] = await db.query(`SELECT invoiceNo FROM \`invoices\` WHERE invoiceNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(invoiceNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`, [likePattern]);
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastInvoiceNo = (rows as any[])[0].invoiceNo as string;
                const parts = lastInvoiceNo.split('/');
                const suffix = parts[parts.length - 1];
                lastNum = parseInt(suffix || '0', 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, '0');
              data.invoiceNo = `INV/${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate invoiceNo:', (err as Error).message);
          }
        }

        // Auto-generate gateEntryNo for gate_entries when not provided
        if (tableName === 'gate_entries') {
          try {
            if (!data.gateEntryNo) {
              const dateStr = data.date || new Date().toISOString().slice(0,10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `GE/${fyLabel}/%`;
              const [rows] = await db.query(`SELECT gateEntryNo FROM \`gate_entries\` WHERE gateEntryNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(gateEntryNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`, [likePattern]);
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastGateEntryNo = (rows as any[])[0].gateEntryNo as string;
                const parts = lastGateEntryNo.split('/');
                const suffix = parts[parts.length - 1];
                lastNum = parseInt(suffix || '0', 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, '0');
              data.gateEntryNo = `GE/${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate gateEntryNo:', (err as Error).message);
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
        if (tableName === "indents") {
          await db.query("DELETE FROM `indent_lines` WHERE `indentId` = ?", [id]);
        }
        if (tableName === "purchase_orders") {
          await db.query("DELETE FROM `purchase_order_lines` WHERE `purchaseOrderId` = ?", [id]);
        }
        if (tableName === "gate_entries") {
          await db.query("DELETE FROM `gate_entry_photos` WHERE `gateEntryId` = ?", [id]);
        }
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
const entities = ["item_groups", "material_groups", "items", "materials", "indents", "indent_lines", "purchase_orders", "purchase_order_lines", "gate_entries", "gate_entry_photos", "suppliers", "states", "color_masters", "companies", "orders", "orders_schedule", "material_in", "users", "productions", "consumptions", "sample_requests", "trucks", "dispatch_plans", "loading_slips", "invoices", "invoice_line_items", "settings"];
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
