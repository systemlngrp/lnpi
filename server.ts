import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json({ limit: "50mb" }));

app.get("/uploads/:filename", async (req, res, next) => {
  const filename = String(req.params.filename || "").trim();
  if (!filename) return res.status(400).send("Missing filename");

  try {
    const db = await getPool();
    if (!db) return next();

    const [rows] = await db.query("SELECT mimeType, data FROM `uploaded_files` WHERE filename = ? LIMIT 1", [filename]);
    const row = (rows as any[])?.[0];
    if (!row?.data) return next();

    const mimeType = String(row.mimeType || "application/octet-stream");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    return res.send(data);
  } catch (error) {
    console.error("[uploads] Failed to serve from DB:", error);
    return next();
  }
});

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

type AuthUser = {
  id: string;
  userId: string;
  name: string;
  email?: string | null;
  role: "Admin" | "Employee" | "Operator";
  status: "Active" | "Inactive";
  menuAccess: string[];
};

const AUTH_SECRET = process.env.AUTH_SECRET || "dev-auth-secret-change-me";
const AUTH_TTL_SECONDS = Number(process.env.AUTH_TTL_SECONDS || 60 * 60 * 24); // 24h
const NPD_SYNC_SECRET = String(process.env.NPD_SYNC_SECRET || "").trim();
const NPD_SYNC_ALLOWED_TAB = String(process.env.NPD_SYNC_ALLOWED_TAB || "NPD").trim();
const NPD_SYNC_LOG_PREFIX = "[NPD_SYNC]";

const NPD_SYNC_HEADER_MAP = {
  "NPD ID": "npdId",
  Timestamp: "timestamp",
  Date: "date",
  "BOX TYPE": "boxType",
  "Company Id": "companyId",
  "Customer Name": "customerName",
  "Contact Person": "contactPerson",
  "Contact Number": "contactNumber",
  Email: "email",
  "Item Name": "itemName",
  ERP: "erp",
  Rate: "rate",
  "Last Approved Order rate": "rate",
  UOM: "uom",
  "Flute Type": "fluteType",
  Ply: "ply",
  "No Of Parts": "noOfParts",
  "No Of Ups": "noOfUps",
  "Id to Od 2": "idToOd2",
  "Open Length": "openLength",
  "Open Width": "openWidth",
  "Length (ID)": "lengthId",
  "Breadth (ID)": "breadthId",
  "Height (ID)": "heightId",
  "Length (OD)": "lengthOd",
  "Breadth (OD)": "breadthOd",
  "Height (OD)": "heightOd",
  "PS-L1": "psL1",
  "PS L1-BF": "psL1Bf",
  "PS F1": "psF1",
  "PS F1-BF": "psF1Bf",
  "PS L2": "psL2",
  "PS L2-BF": "psL2Bf",
  "PS F2": "psF2",
  "PS F2-BF": "psF2Bf",
  "PS L3": "psL3",
  "PS L3-BF": "psL3Bf",
  "Material Weight inside in One Box": "materialWeightInsideInOneBox",
  "Stack Height": "stackHeight",
  "Safety Factor": "safetyFactor",
  "CS (Kg) Std": "csKgStd",
  "CS (Kg) Target": "csKgTarget",
  "BS (kg/cm2) Std": "bsKgCm2Std",
  "BS (kg/cm2) Calculated": "bsKgCm2Calculated",
  "Take up Factor": "takeUpFactor",
  UPS: "ups",
  RAPC: "rapc",
  Opening: "opening",
  Receipt: "receipt",
  Production: "production",
  Invoiced: "invoiced",
  Balance: "balance",
  "GST Rate": "gstRate",
  Part: "part",
  "Cutting with Trimming": "cuttingWithTrimming",
  "Standard Weight(gms)": "standardWeightGms",
  "Calculated Weight per Box": "calculatedWeightPerBox",
  "Standard B GSM": "standardBGsm",
  "Calculated B GSM": "calculatedBGsm",
  "Stitching/Gluing": "stitchingGluing",
  RSL1: "rsl1",
  "RSL1-BF": "rsl1Bf",
  RSF2: "rsf2",
  "RSF2-BF": "rsf2Bf",
  RSL3: "rsl3",
  "RSL3-BF": "rsl3Bf",
  RSF4: "rsf4",
  "RSF4-BF": "rsf4Bf",
  RSL5: "rsl5",
  "RSF5-BF": "rsf5Bf",
  "Flap Size": "flapSize",
  "Deckle Size": "deckleSize",
  "Top Paper Shade": "topPaperShade",
  "Color Id 1": "colorId1",
  "Printing Colour 1": "printingColour1",
  "Color Id 2": "colorId2",
  "Printing Colour 2": "printingColour2",
  "PLAIN BOX": "plainBox",
  "Whether Plate Applicable": "whetherPlateApplicable",
  "Whether PHP Applicable": "whetherPhpApplicable",
  "Dimensions Approved": "dimensionsApproved",
  "Artwork Approved": "artworkApproved",
  "Artwork Upload": "artworkUpload",
  URL: "url",
  "PO Date": "poDate",
  "PO Number": "poNumber",
  Supplier: "supplier",
  "Printing Block Item Name": "printingBlockItemName",
  "Block Size (Sq Inch)": "blockSizeSqInch",
  "Approved Rate of Supplier": "approvedRateOfSupplier",
  "PO PDF": "poPdf",
  "Chargeable to Customer": "chargeableToCustomer",
  Amount: "amount",
  "PO PDF Approval": "poPdfApproval",
  "Email Sent to Supplier": "emailSentToSupplier",
  "Email Timestamp": "emailTimestamp",
  "Invoice No.": "invoiceNo",
  "Invoice Date": "invoiceDate",
  "Invoice Amount": "invoiceAmount",
  "GE No.": "geNo",
  "MRR No.": "mrrNo",
  "Date of Receipt": "dateOfReceipt",
  "Supplier Invoice No.(MRR)": "supplierInvoiceNoMrr",
  "Item Value (MRR)": "itemValueMrr",
  "Invoice Value (MRR)": "invoiceValueMrr",
  "Approval Status": "approvalStatus",
  "Debit Note No.": "debitNoteNo",
  "Debit Note Date": "debitNoteDate",
  "Debit Note Amount": "debitNoteAmount",
  "Customer PO No.": "customerPoNo",
  "Customer PO Date": "customerPoDate",
  "Order Quantity": "orderQuantity",
  "Order Rate": "orderRate",
  "Customer PO Amount": "customerPoAmount",
  "No. of Boxes per Sheet in case of Die Cut Box": "boxesPerSheetDieCut",
  "Reel Size": "reelSize",
  "Cutting Size": "cuttingSize",
  "Rapc for single box": "rapcForSingleBox",
  "No Of Die Cut Ups(No Of Boxes In One Die Sheet)": "dieCutUps",
  "SYNC IN ITEM MASTER": "syncInItemMaster",
  "PLATE/PHP WEIGHT": "platePhpWeight",
  "NPD Update Timestamp": "npdUpdateTimestamp",
  "GSM Least Cost": "gsmLeastCost",
  "Backing Paper Shade": "backingPaperShade",
  "9001": "item9001",
  "9002": "item9002",
  "9003": "item9003",
  "9004": "item9004",
  Artwork: "artwork",
  Spec: "spec",
} as const;

const NPD_SYNC_REQUIRED_HEADERS = ["NPD ID"] as const;

const COMPANY_SYNC_HEADER_MAP = {
  "Id": "id",
  "Company": "name",
  "Address": "address",
  "District": "district",
  "State": "state",
  "GST NO": "gstNo",
  "Email": "email",
  "Contact Person": "contactPerson",
  "Contact Number": "contactNumber",
  "PIN": "pin",
  "NPD Hostinger Sync": "npdHostingerSync",
  "Sales Person": "salesPerson",
  "GST Type": "gstType",
  "PAN No": "panNo",
} as const;

const COMPANY_SYNC_REQUIRED_HEADERS = ["Id", "Company"] as const;

const PHP_ITEM_MASTER_HEADER_MAP = {
  "Timestamp": "timestamp",
  "NPD_ID": "npdId",
  "ERP Item Code": "erpItemCode",
  "Master Item Name ERP Code": "masterItemNameErpCode",
  "Item Name": "itemName",
  "Company": "company",
  "Rate": "rate",
  "Length": "length",
  "Breadth": "breadth",
  "Height": "height",
  "Creasor 1": "creasor1",
  "Creasor 2": "creasor2",
  "No. of Ply": "noOfPly",
  "Number of Holes in PHP": "numberOfHolesInPhp",
  "Number of Sets/ Pcs per Box": "numberOfSetsPerBox",
  "Flute Type": "fluteType",
  "Take Up": "takeUp",
  "L1": "l1",
  "L1 BF": "l1Bf",
  "F1": "f1",
  "F1 BF": "f1Bf",
  "L2": "l2",
  "L2 BF": "l2Bf",
  "F2": "f2",
  "F2 BF": "f2Bf",
  "L3": "l3",
  "L3 BF": "l3Bf",
  "Board GSM (req) GM/m2": "boardGsmReq",
  "Brusting Strength (Req) KG/cm2": "brustingStrengthReq",
  "Weight Per Pc/ Set (req)": "weightPerPcReq",
  "Calculated Weight Per PC/Set(req)": "calculatedWeightPerPcReq",
  "Item Id": "itemId",
  "phpid": "phpId",
  "PHPID": "phpId",
  "php_id": "phpId",
  "PHP ID": "phpId",
  "php id": "phpId",
  "CATEGORY": "category",
  "Holes Oreintation (L )": "holesOrientationL",
  "Holes Oreintation (W)": "holesOrientationW",
  "No. of Length Plates": "noOfLengthPlates",
  "No. of Length  Plates": "noOfLengthPlates",
  "No. of Width Plates": "noOfWidthPlates",
  "No. of Width  Plates": "noOfWidthPlates",
  "No. of Ups for RAPC": "noOfUpsForRapc",
  "RAPC": "rapc",
  "No. of Ups for Cutting Length (Length piece)": "noOfUpsForCuttingLengthPiece",
  "Cutting Size (Length Piece)": "cuttingSizeLengthPiece",
  "No. of Ups for Cutting Length (Width Piece)": "noOfUpsForCuttingWidthPiece",
  "Cutting Size (Width Piece)": "cuttingSizeWidthPiece",
  "Plan Qty": "planQty",
  "Sheet Required to Produce (Length Piece)": "sheetRequiredLengthPiece",
  "Sheet Required to Produce (Width Piece)": "sheetRequiredWidthPiece",
  "Cutter Location": "cutterLocation",
  "FOC or non FOC": "focOrNonFoc",
  "If Non FOC then Rate": "nonFocRate",
  "Deviation": "deviation",
  "Approval Timestamp": "approvalTimestamp",
  "Approval Email": "approvalEmail",
  "BOX TYPE": "boxType",
  "SYNC IN ITEM MASTER": "syncInItemMaster",
  "Total Weight (Grams": "totalWeightGrams",
  "Total Weight (Grams)": "totalWeightGrams",
  "Calculated B GSM": "calculatedBGsm",
  "Calcuted B GSM": "calculatedBGsm",
  "Calculted B GSM": "calculatedBGsm",
  "Hostinger Sync": "hostingerSync",
} as const;

const PHP_ITEM_MASTER_REQUIRED_HEADERS = ["phpid"] as const;

const PLATE_ITEM_MASTER_HEADER_MAP = {
  "Timestamp": "timestamp",
  "NPD_ID": "npdId",
  "ERP Item Code": "erpItemCode",
  "Master Item Name ERP Code": "masterItemNameErpCode",
  "Item Name": "itemName",
  "Company": "company",
  "Rate": "rate",
  "Type of Plate": "typeOfPlate",
  "Length": "length",
  "Breadth": "breadth",
  "Height": "height",
  "Creasor 1": "creasor1",
  "Creasor 2": "creasor2",
  "No. of Ply": "noOfPly",
  "Number of Sets/ Pcs per Box": "numberOfSetsPerBox",
  "Flute Type": "fluteType",
  "Take Up": "takeUp",
  "L1": "l1",
  "L1 BF": "l1Bf",
  "F1": "f1",
  "F1 BF": "f1Bf",
  "L2": "l2",
  "L2 BF": "l2Bf",
  "F2": "f2",
  "F2 BF": "f2Bf",
  "L3": "l3",
  "L3 BF": "l3Bf",
  "Board GSM (req) GM/m2": "boardGsmReq",
  "Brusting Strength (Req) KG/cm2": "brustingStrengthReq",
  "Weight Per Pc/ Set (req)": "weightPerPcReq",
  "Calculated Weight Per PC/Set(req)": "calculatedWeightPerPcReq",
  "Item Id": "itemId",
  "plateid": "plateId",
  "Plate ID": "plateId",
  "plate id": "plateId",
  "CATEGORY": "category",
  "No. of Ups for RAPC": "noOfUpsForRapc",
  "RAPC": "rapc",
  "No. of Ups for Cutting": "noOfUpsForCutting",
  "Cutting Size (Length Piece)": "cuttingSizeLengthPiece",
  "Plan Qty": "planQty",
  "Sheet Required to Produce (Length Piece)": "sheetRequiredLengthPiece",
  "Cutter Location": "cutterLocation",
  "FOC or non FOC": "focOrNonFoc",
  "If Non FOC then Rate": "nonFocRate",
  "Deviation": "deviation",
  "Approval Timestamp": "approvalTimestamp",
  "Approval Email": "approvalEmail",
  "BOX TYPE": "boxType",
  "SYNC IN ITEM MASTER": "syncInItemMaster",
  "Calculated B GSM": "calculatedBGsm",
  "Calcuted B GSM": "calculatedBGsm",
  "Calculted B GSM": "calculatedBGsm",
  "Total Weight (Grams": "totalWeightGrams",
  "Total Weight (Grams)": "totalWeightGrams",
  "Hostinger Sync": "hostingerSync",
} as const;

const PLATE_ITEM_MASTER_REQUIRED_HEADERS = ["plateid"] as const;

const NPD_SYNC_NUMERIC_KEYS = new Set([
  "erp",
  "rate",
  "openLength",
  "openWidth",
  "lengthId",
  "breadthId",
  "heightId",
  "lengthOd",
  "breadthOd",
  "heightOd",
  "psL1",
  "psL1Bf",
  "psF1",
  "psF1Bf",
  "psL2",
  "psL2Bf",
  "psF2",
  "psF2Bf",
  "psL3",
  "psL3Bf",
  "materialWeightInsideInOneBox",
  "stackHeight",
  "safetyFactor",
  "csKgStd",
  "csKgTarget",
  "bsKgCm2Std",
  "bsKgCm2Calculated",
  "takeUpFactor",
  "ups",
  "rapc",
  "opening",
  "receipt",
  "production",
  "invoiced",
  "balance",
  "gstRate",
  "standardWeightGms",
  "calculatedWeightPerBox",
  "standardBGsm",
  "calculatedBGsm",
  "blockSizeSqInch",
  "approvedRateOfSupplier",
  "amount",
  "invoiceAmount",
  "itemValueMrr",
  "invoiceValueMrr",
  "debitNoteAmount",
  "orderQuantity",
  "orderRate",
  "customerPoAmount",
  "boxesPerSheetDieCut",
  "rapcForSingleBox",
  "dieCutUps",
  "platePhpWeight",
  "gsmLeastCost",
  "ply",
  "noOfParts",
  "noOfUps",
  "deviationAllowed",
  "toleranceAllowed",
]);

const NPD_SCHEMA_COLUMNS: Array<{ column: string; type: string }> = [
  ...[...new Set(Object.values(NPD_SYNC_HEADER_MAP))].map((column) => ({
    column,
    type: "LONGTEXT",
  })),
  { column: "syncSource", type: "VARCHAR(50) NULL" },
  { column: "syncStatus", type: "VARCHAR(20) DEFAULT 'active'" },
];

const PHP_ITEM_MASTER_SCHEMA_COLUMNS: Array<{ column: string; type: string }> = [
  ...[...new Set(Object.values(PHP_ITEM_MASTER_HEADER_MAP))].map((column) => ({
    column,
    type: "LONGTEXT",
  })),
  { column: "syncSource", type: "VARCHAR(50) NULL" },
  { column: "syncStatus", type: "VARCHAR(20) DEFAULT 'active'" },
];

const PLATE_ITEM_MASTER_SCHEMA_COLUMNS: Array<{ column: string; type: string }> = [
  ...[...new Set(Object.values(PLATE_ITEM_MASTER_HEADER_MAP))].map((column) => ({
    column,
    type: "LONGTEXT",
  })),
  { column: "syncSource", type: "VARCHAR(50) NULL" },
  { column: "syncStatus", type: "VARCHAR(20) DEFAULT 'active'" },
];

const COMPANY_SCHEMA_COLUMNS: Array<{ column: string; type: string }> = [
  { column: "pin", type: "VARCHAR(50)" },
  { column: "npdHostingerSync", type: "VARCHAR(255)" },
  { column: "salesPerson", type: "VARCHAR(255)" },
  { column: "gstType", type: "VARCHAR(100)" },
  { column: "panNo", type: "VARCHAR(100)" },
];

function base64UrlEncode(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeToString(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

function signToken(payload: Record<string, unknown>) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + AUTH_TTL_SECONDS };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const bodyPart = base64UrlEncode(JSON.stringify(body));
  const data = `${headerPart}.${bodyPart}`;
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(data).digest();
  return `${data}.${base64UrlEncode(sig)}`;
}

function verifyToken(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, bodyPart, sigPart] = parts;
  const data = `${headerPart}.${bodyPart}`;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(data).digest();
  const expectedPart = base64UrlEncode(expected);
  if (sigPart.length !== expectedPart.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sigPart), Buffer.from(expectedPart))) return null;

  try {
    const body = JSON.parse(base64UrlDecodeToString(bodyPart));
    const exp = Number((body as any)?.exp || 0);
    const now = Math.floor(Date.now() / 1000);
    if (!exp || exp < now) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeMenuAccess(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
      // ignore
    }
  }
  return [];
}

function normalizeStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((value) => String(value || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value || "").trim()).filter(Boolean);
    } catch {
      // ignore
    }
  }
  return [];
}

function normalizeUserRole(raw: unknown): AuthUser["role"] {
  const role = String(raw || "Employee").trim();
  if (role === "Admin") return "Admin";
  if (role === "Operator") return "Operator";
  return "Employee";
}

function hasPermission(user: AuthUser, required: string) {
  if (user.role === "Admin") return true;
  if (user.status !== "Active") return false;
  if (user.role === "Operator") return true;
  const list = user.menuAccess || [];
  if (list.includes("*")) return true;
  if (!required) return false;
  return list.some((entry) => {
    if (!entry) return false;
    if (entry === required) return true;
    if (required.startsWith(entry)) return true; // user granted section access like "/production"
    if (entry.startsWith(required)) return true; // user granted a specific page under this section
    if (entry.endsWith("/*") && required.startsWith(entry.slice(0, -1))) return true;
    return false;
  });
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  const uid = String((payload as any).uid || "");
  if (!uid) return res.status(401).json({ error: "Unauthorized" });
  (req as any).authUserId = uid;
  next();
}

app.post("/api/auth/login", async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.userId || req.body?.email || "").trim();
  const password = String(req.body?.password || "").trim();

  if (!identifier || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  try {
    const [rows] = await db.query(
      "SELECT * FROM `users` WHERE userId = ? OR email = ? LIMIT 1",
      [identifier, identifier]
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(401).json({ error: "Invalid credentials" });

    const status = String(row.status || "Active") === "Inactive" ? "Inactive" : "Active";
    if (status !== "Active") return res.status(403).json({ error: "User is inactive" });

    const storedPassword = String(row.password || "");
    if (!storedPassword || storedPassword !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user: AuthUser = {
      id: String(row.id),
      userId: String(row.userId || ""),
      name: String(row.name || ""),
      email: row.email ? String(row.email) : null,
      role: normalizeUserRole(row.role),
      status,
      menuAccess: normalizeMenuAccess(row.menuAccess),
    };

    const token = signToken({ uid: user.id });
    res.json({
      token,
      user: {
        id: user.id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        menuAccess: user.menuAccess,
      },
    });
  } catch (error) {
    console.error("[AUTH] login failed:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    id: user.id,
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    menuAccess: user.menuAccess,
  });
});

app.post("/api/auth/logout", requireAuth, async (_req, res) => {
  // Stateless token: client just deletes token.
  res.json({ success: true });
});

// Protect all /api routes except auth + db-status
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path === "/db-status" || req.path.startsWith("/npd-sync")) return next();
  return requireAuth(req, res, next);
});

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
    const base64String = String(base64);
    const match = base64String.match(/^data:([^;]+);base64,/i);
    const mimeType = match?.[1] || "application/octet-stream";
    // Robustly extract base64 data regardless of prefix
    const base64Data = base64String.replace(/^data:.*;base64,/, "");
    const extension = path.extname(String(filename)) || ".bin";
    const newFilename = `${crypto.randomUUID()}${extension}`;
    const fileBuffer = Buffer.from(base64Data, "base64");

    const db = await getPool();
    if (db) {
      await db.query("REPLACE INTO `uploaded_files` (`filename`, `mimeType`, `data`) VALUES (?, ?, ?)", [
        newFilename,
        mimeType,
        fileBuffer,
      ]);
    } else {
      console.warn("[UPLOAD] DB not available; falling back to filesystem upload only.");
    }

    // Optional disk write (useful for local dev / fallback)
    try {
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, newFilename);
      fs.writeFileSync(filePath, fileBuffer);
    } catch (diskError) {
      console.warn("[UPLOAD] Failed to write file to disk (continuing):", diskError);
    }

    console.log(`[UPLOAD] Saved ${filename} as ${newFilename} (${mimeType})`);
    return res.json({ filename: newFilename });
  } catch (error) {
    console.error("Upload failed:", error);
    return res.status(500).json({ error: "Failed to save file" });
  }
});

app.post("/api/npd-sync", async (req, res) => {
  const providedSecret = stringOrEmpty(
    req.headers["x-npd-sync-secret"] ||
      req.headers["x-sync-secret"] ||
      req.query.secret ||
      req.body?.secret
  );

  if (!NPD_SYNC_SECRET) {
    return res.status(503).json({ error: "NPD sync is not configured." });
  }

  if (!providedSecret || providedSecret !== NPD_SYNC_SECRET) {
    return res.status(401).json({ error: "Invalid sync secret." });
  }

  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  const tabName = stringOrEmpty(req.body?.tabName || req.body?.sheetName || req.body?.tab);
  const rawRowsPayload = req.body?.rows;
  const syncTimestamp = stringOrEmpty(req.body?.syncTimestamp || new Date().toISOString());
  const syncModeRaw = stringOrEmpty(req.body?.syncMode || "batch").toLowerCase();
  const syncMode = syncModeRaw === "full_finalize"
    ? "full_finalize"
    : syncModeRaw === "full_batch_chunk"
      ? "full_batch_chunk"
      : syncModeRaw === "full"
        ? "full"
        : "batch";
  const spreadsheetName = stringOrEmpty(req.body?.spreadsheetName);
  const spreadsheetId = stringOrEmpty(req.body?.spreadsheetId);
  const finalizeProcessedIds = normalizeSyncIdList(req.body?.processedIds);

  if (!tabName) {
    return res.status(400).json({ error: "tabName is required." });
  }

  const tabConfigs: Record<string, any> = {
    [NPD_SYNC_ALLOWED_TAB]: {
      table: "npd",
      idColumn: "npdId",
      headerMap: NPD_SYNC_HEADER_MAP,
      requiredHeaders: NPD_SYNC_REQUIRED_HEADERS,
      mapFn: mapSheetRowToNpdRow,
      skipIfHostingerSynced: true,
    },
    "PHP ITEM MASTER": {
      table: "php_item_master",
      idColumn: "phpId",
      headerMap: PHP_ITEM_MASTER_HEADER_MAP,
      requiredHeaders: PHP_ITEM_MASTER_REQUIRED_HEADERS,
      skipIfHostingerSynced: true,
      mapFn: (row: Record<string, any>) => {
        const mapped = mapSheetRowByHeaderMap_(row, PHP_ITEM_MASTER_HEADER_MAP as Record<string, string>);
        mapped.phpId = stringOrEmpty(mapped.phpId || mapped.itemId);
        mapped.itemId = stringOrEmpty(mapped.itemId);
        return mapped;
      },
    },
    "PLATE ITEM MASTER": {
      table: "plate_item_master",
      idColumn: "plateId",
      headerMap: PLATE_ITEM_MASTER_HEADER_MAP,
      requiredHeaders: PLATE_ITEM_MASTER_REQUIRED_HEADERS,
      skipIfHostingerSynced: true,
      mapFn: (row: Record<string, any>) => {
        const mapped = mapSheetRowByHeaderMap_(row, PLATE_ITEM_MASTER_HEADER_MAP as Record<string, string>);
        mapped.plateId = stringOrEmpty(mapped.plateId || mapped.itemId);
        mapped.itemId = stringOrEmpty(mapped.itemId);
        return mapped;
      },
    },
    "Companies": {
      table: "companies",
      idColumn: "id",
      headerMap: COMPANY_SYNC_HEADER_MAP,
      requiredHeaders: COMPANY_SYNC_REQUIRED_HEADERS,
      skipIfHostingerSynced: true,
      mapFn: (row: Record<string, any>) => {
        const mapped: Record<string, any> = {};
        
        // Map all headers based on the map
        Object.entries(COMPANY_SYNC_HEADER_MAP).forEach(([header, key]) => {
          if (!Object.prototype.hasOwnProperty.call(row, header)) return;
          mapped[key] = normalizeSheetCellValue(key, row[header]);
        });

        // Ensure name is present even if header was different
        if (!mapped.name) {
          mapped.name = stringOrEmpty(row["Company"] || row["Company Name"] || row["name"]);
        }

        // Ensure id is present or generate it
        if (!mapped.id) {
          const idVal = stringOrEmpty(row["Id"] || row["id"] || row["ID"]);
          if (idVal) {
            mapped.id = idVal;
          } else if (mapped.name) {
            // Generate stable UUID based on company name
            const hash = crypto.createHash("md5").update(String(mapped.name).trim().toUpperCase()).digest("hex");
            mapped.id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
          }
        }
        
        return mapped;
      },
    }
  };

  const config = tabConfigs[tabName];
  if (!config) {
    return res.status(400).json({ error: `Only tab(s) ${Object.keys(tabConfigs).filter(Boolean).join(", ")} are allowed.` });
  }

  if (syncMode !== "full_finalize" && !Array.isArray(rawRowsPayload)) {
    return res.status(400).json({ error: "rows must be an array." });
  }
  const rowsPayload = Array.isArray(rawRowsPayload) ? (rawRowsPayload as any[]) : [];

  if (syncMode === "full_finalize" && finalizeProcessedIds.length === 0) {
    return res.status(400).json({ error: "processedIds is required for full_finalize." });
  }

  console.log(
    `${NPD_SYNC_LOG_PREFIX} Request received`,
    JSON.stringify({
      tabName,
      syncMode,
      spreadsheetName,
      spreadsheetId,
      totalRowsReceived: rowsPayload.length,
      syncTimestamp,
    })
  );

  let missingRequiredHeaders: string[] = [];
  if (syncMode !== "full_finalize" && tabName === "Companies") {
    const hasIdHeader = rowsPayload.some((row) =>
      Object.prototype.hasOwnProperty.call(row || {}, "Id") ||
      Object.prototype.hasOwnProperty.call(row || {}, "id") ||
      Object.prototype.hasOwnProperty.call(row || {}, "ID")
    );
    const hasCompanyHeader = rowsPayload.some((row) =>
      Object.prototype.hasOwnProperty.call(row || {}, "Company") ||
      Object.prototype.hasOwnProperty.call(row || {}, "Company Name")
    );
    if (!hasIdHeader) {
      missingRequiredHeaders.push("Id");
    }
    if (!hasCompanyHeader) {
      missingRequiredHeaders.push("Company or Company Name");
    }
  } else if (syncMode !== "full_finalize") {
    missingRequiredHeaders = config.requiredHeaders.filter((header) =>
      rowsPayload.length > 0 && !rowsPayload.some((row) => Object.prototype.hasOwnProperty.call(row || {}, header))
    );
  }
  if (missingRequiredHeaders.length > 0) {
    return res.status(400).json({ error: `Missing required header(s): ${missingRequiredHeaders.join(", ")}` });
  }

  const normalizedRows = rowsPayload.map((row, index) => {
    const mapped = config.mapFn((row || {}) as Record<string, any>);
    return {
      rowNumber: index + 2,
      source: row || {},
      mapped,
    };
  });

  const eligibleRows = config.skipIfHostingerSynced
    ? normalizedRows.filter((entry) => stringOrEmpty(entry.mapped.hostingerSync) === "")
    : normalizedRows;

  const invalidRows = eligibleRows
    .filter((entry) => !entry.mapped[config.idColumn])
    .map((entry) => ({
      rowNumber: entry.rowNumber,
      reason: `Missing ${config.idColumn}`,
      itemName: stringOrEmpty(entry.source?.["Item Name"] || entry.source?.["Company Name"] || entry.source?.["Name"]),
    }));

  const duplicateCounter = new Map<string, number>();
  const dedupedById = new Map<string, (typeof normalizedRows)[number]>();
  eligibleRows.forEach((entry) => {
    const syncId = stringOrEmpty(entry.mapped[config.idColumn]);
    const businessKey = resolveSheetSyncBusinessKey_(config, entry.mapped);
    const dedupeKey = businessKey || syncId;
    if (!dedupeKey) return;
    duplicateCounter.set(dedupeKey, (duplicateCounter.get(dedupeKey) || 0) + 1);
    dedupedById.set(dedupeKey, entry);
  });
  const duplicateIds = [...duplicateCounter.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id.startsWith("erp:") ? id.slice(4) : id);

  const validRows = [...dedupedById.values()];
  const incomingIds = syncMode === "full_finalize"
    ? finalizeProcessedIds
    : normalizeSyncIdList(validRows.map((entry) => entry.mapped[config.idColumn]));
  const processedIds = incomingIds;

  if ((syncMode === "full" || syncMode === "full_batch_chunk") && duplicateIds.length > 0) {
    console.error(`${NPD_SYNC_LOG_PREFIX} Duplicate IDs in full sync`, duplicateIds);
    return res.status(400).json({
      error: `Duplicate ${config.idColumn} values found in sync payload.`,
      duplicateIds,
    });
  }

  if (duplicateIds.length > 0) {
    console.warn(
      `${NPD_SYNC_LOG_PREFIX} Deduplicated repeated IDs in batch payload`,
      JSON.stringify({ duplicateIds, keptRows: validRows.length })
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.query(
      config.table === "npd"
        ? `SELECT id, \`${config.idColumn}\` as syncId, \`erp\` as erp FROM \`${config.table}\``
        : `SELECT id, \`${config.idColumn}\` as syncId FROM \`${config.table}\` WHERE \`${config.idColumn}\` IS NOT NULL AND TRIM(\`${config.idColumn}\`) <> ''`
    );
    const existingBySyncId = new Map<string, any>();
    const existingByBusinessKey = new Map<string, any>();
    (existingRows as any[]).forEach((row) => {
      const syncId = stringOrEmpty(row.syncId);
      if (syncId) existingBySyncId.set(syncId, row);
      if (config.table === "npd") {
        const erp = stringOrEmpty((row as any).erp);
        if (erp) existingByBusinessKey.set(`erp:${erp}`, row);
      }
    });

    let inserted = 0;
    let updated = 0;

    if (syncMode !== "full_finalize") {
      for (const entry of validRows) {
        const syncId = stringOrEmpty(entry.mapped[config.idColumn]);
        const businessKey = resolveSheetSyncBusinessKey_(config, entry.mapped);
        const existing = existingBySyncId.get(syncId) || (businessKey ? existingByBusinessKey.get(businessKey) : null);
        const payload: Record<string, any> = {
          id: stringOrEmpty(existing?.id) || (config.idColumn === 'id' ? syncId : null) || crypto.randomUUID(),
          ...entry.mapped,
          syncSource: "google_sheets",
          syncStatus: "active",
          updatedBy: "Google Sheets Sync",
          updateTimestamp: syncTimestamp,
        };

        const columns = Object.keys(payload);
        const values = columns.map((column) => payload[column]);
        const insertColumns = columns.map((column) => `\`${column}\``).join(", ");
        const insertPlaceholders = columns.map(() => "?").join(", ");
        const updateColumns = columns
          .filter((column) => column !== "id")
          .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
          .join(", ");

        await conn.query(
          `INSERT INTO \`${config.table}\` (${insertColumns})
           VALUES (${insertPlaceholders})
           ON DUPLICATE KEY UPDATE ${updateColumns}`,
          values
        );

        existingBySyncId.set(syncId, { id: payload.id, syncId });
        if (businessKey) {
          existingByBusinessKey.set(businessKey, { id: payload.id, syncId });
        }

        if (existing) updated++;
        else inserted++;
      }
    }

    let removed = 0;
    if (syncMode === "full" || syncMode === "full_finalize") {
      if (incomingIds.length > 0) {
        await conn.query(
          `UPDATE \`${config.table}\`
           SET \`syncStatus\` = 'active',
               \`updatedBy\` = 'Google Sheets Sync',
               \`updateTimestamp\` = ?
           WHERE \`syncSource\` = 'google_sheets'
             AND \`${config.idColumn}\` IN (${incomingIds.map(() => "?").join(", ")})`,
          [syncTimestamp, ...incomingIds]
        );
        const [result] = await conn.query(
          `UPDATE \`${config.table}\`
           SET \`syncStatus\` = 'removed',
               \`updatedBy\` = 'Google Sheets Sync',
               \`updateTimestamp\` = ?
           WHERE \`syncSource\` = 'google_sheets'
             AND COALESCE(NULLIF(TRIM(\`${config.idColumn}\`), ''), '') <> ''
             AND \`${config.idColumn}\` NOT IN (${incomingIds.map(() => "?").join(", ")})
             AND COALESCE(NULLIF(TRIM(\`syncStatus\`), ''), 'active') <> 'removed'`,
          [syncTimestamp, ...incomingIds]
        );
        removed = Number((result as any)?.affectedRows || 0);
      } else {
        const [result] = await conn.query(
          `UPDATE \`${config.table}\`
           SET \`syncStatus\` = 'removed',
               \`updatedBy\` = 'Google Sheets Sync',
               \`updateTimestamp\` = ?
           WHERE \`syncSource\` = 'google_sheets'
             AND COALESCE(NULLIF(TRIM(\`syncStatus\`), ''), 'active') <> 'removed'`,
          [syncTimestamp]
        );
        removed = Number((result as any)?.affectedRows || 0);
      }
    }

    await conn.commit();
    const responsePayload = {
      ok: true,
      tabName,
      syncMode,
      syncTimestamp,
      totalRowsReceived: rowsPayload.length,
      processedRows: validRows.length,
      processedIds,
      inserted,
      updated,
      removed,
      duplicateIds,
      invalidRows,
    };
    console.log(`${NPD_SYNC_LOG_PREFIX} Sync completed`, JSON.stringify(responsePayload));
    res.json(responsePayload);
  } catch (error) {
    await conn.rollback();
    console.error(`${NPD_SYNC_LOG_PREFIX} Sync failed:`, error);
    res.status(500).json({ error: (error as Error).message });
  } finally {
    conn.release();
  }
});

app.get("/api/npd-sync/rates", async (req, res) => {
  const providedSecret = stringOrEmpty(
    req.headers["x-npd-sync-secret"] ||
      req.headers["x-sync-secret"] ||
      req.query.secret
  );

  if (!NPD_SYNC_SECRET) {
    return res.status(503).json({ error: "NPD sync is not configured." });
  }

  if (!providedSecret || providedSecret !== NPD_SYNC_SECRET) {
    return res.status(401).json({ error: "Invalid sync secret." });
  }

  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  try {
    const approvedStatuses = new Set(["Approved", "Pending Scheduling", "Scheduled"]);
    const [orderRows] = await db.query(
      `
      SELECT
        id,
        orderNo,
        orderDate,
        erpCode,
        rate,
        status,
        approvedTimestamp,
        approvedEmail
      FROM \`orders\`
      WHERE COALESCE(NULLIF(TRIM(erpCode), ''), '') <> ''
        AND rate IS NOT NULL
        AND (
          COALESCE(NULLIF(TRIM(approvedTimestamp), ''), '') <> ''
          OR COALESCE(NULLIF(TRIM(approvedEmail), ''), '') <> ''
          OR COALESCE(NULLIF(TRIM(status), ''), '') IN ('Approved', 'Pending Scheduling', 'Scheduled')
        )
      `
    );

    const parseDateValue = (value: any) => {
      const raw = stringOrEmpty(value);
      if (!raw) return 0;
      const direct = Date.parse(raw);
      if (!Number.isNaN(direct)) return direct;
      const ddmmyyyy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (ddmmyyyy) {
        const [, dd, mm, yyyy] = ddmmyyyy;
        const normalized = `${yyyy}-${mm}-${dd}T00:00:00Z`;
        const parsed = Date.parse(normalized);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return 0;
    };

    const getOrderNumberRank = (value: any) => {
      const raw = stringOrEmpty(value);
      if (!raw) return 0;
      const match = raw.match(/(\d+)(?!.*\d)/);
      return match ? Number(match[1]) : 0;
    };

    const latestByErp = new Map<string, {
      erp: string;
      rate: number;
      orderNo: string;
      orderDate: string;
      approvedAt: string;
      status: "approved";
      sortApprovedAt: number;
      sortOrderDate: number;
      sortOrderNo: number;
    }>();

    for (const row of orderRows as any[]) {
      const erp = stringOrEmpty(row?.erpCode);
      const rate = Number(row?.rate);
      const status = stringOrEmpty(row?.status);
      const approvedAt = stringOrEmpty(row?.approvedTimestamp);
      const approvedBy = stringOrEmpty(row?.approvedEmail);
      const isApproved =
        approvedStatuses.has(status) || hasWorkflowValue(approvedAt) || hasWorkflowValue(approvedBy);

      if (!erp || !Number.isFinite(rate) || !isApproved) continue;

      const candidate = {
        erp,
        rate,
        orderNo: stringOrEmpty(row?.orderNo),
        orderDate: stringOrEmpty(row?.orderDate),
        approvedAt,
        status: "approved" as const,
        sortApprovedAt: parseDateValue(approvedAt),
        sortOrderDate: parseDateValue(row?.orderDate),
        sortOrderNo: getOrderNumberRank(row?.orderNo),
      };

      const existing = latestByErp.get(erp);
      if (!existing) {
        latestByErp.set(erp, candidate);
        continue;
      }

      const candidateWins =
        candidate.sortApprovedAt > existing.sortApprovedAt ||
        (candidate.sortApprovedAt === existing.sortApprovedAt &&
          (candidate.sortOrderDate > existing.sortOrderDate ||
            (candidate.sortOrderDate === existing.sortOrderDate &&
              candidate.sortOrderNo > existing.sortOrderNo)));

      if (candidateWins) {
        latestByErp.set(erp, candidate);
      }
    }

    const rateRows = Array.from(latestByErp.values())
      .sort((a, b) => a.erp.localeCompare(b.erp, undefined, { numeric: true, sensitivity: "base" }))
      .map(({ sortApprovedAt, sortOrderDate, sortOrderNo, ...row }) => row);

    return res.json({
      ok: true,
      total: rateRows.length,
      rows: rateRows,
    });
  } catch (error) {
    console.error(`${NPD_SYNC_LOG_PREFIX} Rate sync fetch failed:`, error);
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/tally/sync", async (req, res) => {
  try {
    const user = await getRequestUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    
    console.log("[Tally Sync] Starting sync process...");
    // Run the python script and capture output
    const { stdout, stderr } = await execPromise("python scripts/tally_sync.py");
    
    console.log("[Tally Sync] Output:", stdout);
    if (stderr) {
      console.warn("[Tally Sync] Stderr:", stderr);
    }
    
    return res.json({ 
      success: true,
      message: "Sync process executed.",
      output: stdout,
      error: stderr || null
    });
  } catch (err) {
    console.error("[Tally Sync] Execution Error:", err);
    return res.status(500).json({ 
      error: "Failed to execute sync script. Please ensure Python and required modules are installed.",
      details: (err as Error).message,
      output: (err as any).stdout,
      stderr: (err as any).stderr
    });
  }
});

// Database connection pool
let pool: mysql.Pool | null = null;

type DeleteReference = { table: string; column: string; label: string };
const DELETE_REFERENCES: Record<string, DeleteReference[]> = {
  companies: [
    { table: "orders", column: "companyId", label: "Orders" },
    { table: "invoices", column: "companyId", label: "Invoices" },
    { table: "gate_passes", column: "companyId", label: "Gate Passes" },
  ],
  items: [
    { table: "item_groups", column: "groupId", label: "Item Groups" }, // This is likely backwards, but keeping for safety if it was intended
  ],
  npd: [
    { table: "orders", column: "itemId", label: "Orders" },
    { table: "orders", column: "npdId", label: "Orders" },
    { table: "invoice_line_items", column: "itemId", label: "Invoice Line Items" },
    { table: "invoice_line_items", column: "npdId", label: "Invoice Line Items" },
    { table: "productions", column: "itemId", label: "Productions" },
    { table: "productions", column: "npdId", label: "Productions" },
    { table: "sample_requests", column: "itemId", label: "Sample Requests" },
    { table: "sample_requests", column: "npdId", label: "Sample Requests" },
    { table: "consumptions", column: "itemId", label: "Consumptions" },
    { table: "consumptions", column: "npdId", label: "Consumptions" },
  ],
  orders: [{ table: "orders_schedule", column: "orderId", label: "Order Schedule" }],
  orders_schedule: [
    { table: "productions", column: "scheduleId", label: "Productions" },
    { table: "dispatch_plans", column: "scheduleId", label: "Dispatch Plans" },
  ],
  indents: [
    { table: "indent_lines", column: "indentId", label: "Indent Lines" },
    { table: "purchase_orders", column: "indentId", label: "Purchase Orders" },
  ],
  indent_lines: [{ table: "purchase_order_lines", column: "indentLineId", label: "Purchase Order Lines" }],
  purchase_orders: [{ table: "purchase_order_lines", column: "purchaseOrderId", label: "Purchase Order Lines" }],
  purchase_order_lines: [],
  suppliers: [
    { table: "purchase_orders", column: "supplierId", label: "Purchase Orders" },
    { table: "material_in", column: "supplierId", label: "Material In" },
    { table: "gate_entries", column: "supplierId", label: "Gate Entries" },
  ],
  gate_entries: [
    { table: "gate_entry_photos", column: "gateEntryId", label: "Gate Entry Photos" },
    { table: "material_in", column: "gateEntryId", label: "Material In" },
  ],
  material_in: [{ table: "material_in_packing_slips", column: "materialInId", label: "Packing Slips" }],
  material_in_packing_slips: [
    { table: "material_issue_reel_lines", column: "packingSlipId", label: "Material Issue Reel Lines" },
    { table: "material_return_reel_lines", column: "packingSlipId", label: "Material Return Reel Lines" },
  ],
  materials: [
    { table: "indent_lines", column: "materialId", label: "Indent Lines" },
    { table: "purchase_order_lines", column: "materialId", label: "Purchase Order Lines" },
    { table: "material_issue_lines", column: "materialId", label: "Material Issue Lines" },
    { table: "material_return_lines", column: "materialId", label: "Material Return Lines" },
    { table: "material_in_packing_slips", column: "materialId", label: "Material In Packing Slips" },
  ],
  material_groups: [{ table: "materials", column: "materialGroupId", label: "Materials" }],
  item_groups: [{ table: "items", column: "groupId", label: "Items" }],
  loading_slips: [{ table: "invoice_line_items", column: "loadingSlipId", label: "Invoice Line Items" }],
  invoices: [
    { table: "invoice_line_items", column: "invoiceId", label: "Invoice Line Items" },
    { table: "loading_slips", column: "invoiceId", label: "Loading Slips" },
    { table: "gate_passes", column: "invoiceId", label: "Gate Passes" },
  ],
  productions: [
    { table: "production_processing", column: "productionId", label: "Production Processing" },
    { table: "material_issues", column: "productionId", label: "Material Issues" },
    { table: "material_returns", column: "productionId", label: "Material Returns" },
    { table: "consumptions", column: "productionId", label: "Consumptions" },
  ],
  production_processing: [],
  machines: [{ table: "production_processing", column: "machineId", label: "Production Processing" }],
  trucks: [
    { table: "dispatch_plans", column: "truckId", label: "Dispatch Plans" },
    { table: "loading_slips", column: "truckId", label: "Loading Slips" },
    { table: "gate_passes", column: "truckId", label: "Gate Passes" },
  ],
  material_issues: [
    { table: "material_issue_lines", column: "materialIssueId", label: "Material Issue Lines" },
    { table: "material_issue_reel_lines", column: "materialIssueId", label: "Material Issue Reel Lines" },
  ],
  material_returns: [
    { table: "material_return_lines", column: "materialReturnId", label: "Material Return Lines" },
    { table: "material_return_reel_lines", column: "materialReturnId", label: "Material Return Reel Lines" },
  ],
  material_issue_lines: [{ table: "material_issue_reel_lines", column: "materialIssueLineId", label: "Material Issue Reel Lines" }],
  material_return_lines: [{ table: "material_return_reel_lines", column: "materialReturnLineId", label: "Material Return Reel Lines" }],
};

async function getDeleteBlockers(db: mysql.Pool, tableName: string, id: string) {
  const refs = DELETE_REFERENCES[tableName] || [];
  const blockers: { label: string; count: number }[] = [];
  for (const ref of refs) {
    try {
      const [rows] = await db.query(`SELECT COUNT(*) as cnt FROM \`${ref.table}\` WHERE \`${ref.column}\` = ?`, [id]);
      const count = Number((rows as any[])?.[0]?.cnt || 0);
      if (count > 0) blockers.push({ label: ref.label, count });
    } catch (err) {
      console.warn(`[DB] Delete reference check failed: ${tableName} -> ${ref.table}.${ref.column}`, (err as Error).message);
    }
  }
  return blockers;
}

type ForeignKeyDef = {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  constraintName: string;
  indexName: string;
};

async function ensureIndex(db: mysql.Pool, database: string, table: string, column: string, indexName: string) {
  try {
    const [rows] = await db.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?",
      [database, table, indexName]
    );
    if ((rows as any[]).length > 0) return;

    await db.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (\`${column}\`)`);
    console.log(`[DB] Added index ${indexName} on ${table}(${column})`);
  } catch (err) {
    console.warn(`[DB] Could not ensure index ${indexName} on ${table}(${column}):`, (err as Error).message);
  }
}

async function ensureForeignKey(db: mysql.Pool, database: string, def: ForeignKeyDef) {
  try {
    const [rows] = await db.query(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?",
      [database, def.table, def.constraintName]
    );
    if ((rows as any[]).length > 0) return;

    await ensureIndex(db, database, def.table, def.column, def.indexName);

    await db.query(
      `ALTER TABLE \`${def.table}\` ADD CONSTRAINT \`${def.constraintName}\` FOREIGN KEY (\`${def.column}\`) REFERENCES \`${def.refTable}\` (\`${def.refColumn}\`) ON DELETE RESTRICT ON UPDATE CASCADE`
    );
    console.log(`[DB] Added foreign key ${def.constraintName}: ${def.table}.${def.column} -> ${def.refTable}.${def.refColumn}`);
  } catch (err) {
    console.warn(`[DB] Could not ensure foreign key ${def.constraintName}:`, (err as Error).message);
  }
}

async function ensureBestEffortForeignKeys(db: mysql.Pool, database: string) {
  const defs: ForeignKeyDef[] = [
    {
      table: "indent_lines",
      column: "indentId",
      refTable: "indents",
      refColumn: "id",
      constraintName: "fk_indent_lines_indentId_indents",
      indexName: "idx_indent_lines_indentId",
    },
    {
      table: "purchase_orders",
      column: "indentId",
      refTable: "indents",
      refColumn: "id",
      constraintName: "fk_purchase_orders_indentId_indents",
      indexName: "idx_purchase_orders_indentId",
    },
    {
      table: "purchase_order_lines",
      column: "purchaseOrderId",
      refTable: "purchase_orders",
      refColumn: "id",
      constraintName: "fk_purchase_order_lines_purchaseOrderId_purchase_orders",
      indexName: "idx_purchase_order_lines_purchaseOrderId",
    },
    {
      table: "purchase_order_lines",
      column: "indentLineId",
      refTable: "indent_lines",
      refColumn: "id",
      constraintName: "fk_purchase_order_lines_indentLineId_indent_lines",
      indexName: "idx_purchase_order_lines_indentLineId",
    },
    {
      table: "orders_schedule",
      column: "orderId",
      refTable: "orders",
      refColumn: "id",
      constraintName: "fk_orders_schedule_orderId_orders",
      indexName: "idx_orders_schedule_orderId",
    },
    {
      table: "productions",
      column: "scheduleId",
      refTable: "orders_schedule",
      refColumn: "id",
      constraintName: "fk_productions_scheduleId_orders_schedule",
      indexName: "idx_productions_scheduleId",
    },
    {
      table: "invoices",
      column: "companyId",
      refTable: "companies",
      refColumn: "id",
      constraintName: "fk_invoices_companyId_companies",
      indexName: "idx_invoices_companyId",
    },
    {
      table: "invoice_line_items",
      column: "invoiceId",
      refTable: "invoices",
      refColumn: "id",
      constraintName: "fk_invoice_line_items_invoiceId_invoices",
      indexName: "idx_invoice_line_items_invoiceId",
    },
    {
      table: "invoice_line_items",
      column: "loadingSlipId",
      refTable: "loading_slips",
      refColumn: "id",
      constraintName: "fk_invoice_line_items_loadingSlipId_loading_slips",
      indexName: "idx_invoice_line_items_loadingSlipId",
    },
    {
      table: "invoice_line_items",
      column: "itemId",
      refTable: "npd",
      refColumn: "id",
      constraintName: "fk_invoice_line_items_itemId_npd",
      indexName: "idx_invoice_line_items_itemId",
    },
    {
      table: "gate_passes",
      column: "invoiceId",
      refTable: "invoices",
      refColumn: "id",
      constraintName: "fk_gate_passes_invoiceId_invoices",
      indexName: "idx_gate_passes_invoiceId",
    },
    {
      table: "gate_passes",
      column: "companyId",
      refTable: "companies",
      refColumn: "id",
      constraintName: "fk_gate_passes_companyId_companies",
      indexName: "idx_gate_passes_companyId",
    },
    {
      table: "gate_passes",
      column: "truckId",
      refTable: "trucks",
      refColumn: "id",
      constraintName: "fk_gate_passes_truckId_trucks",
      indexName: "idx_gate_passes_truckId",
    },
    {
      table: "material_issue_lines",
      column: "materialIssueId",
      refTable: "material_issues",
      refColumn: "id",
      constraintName: "fk_material_issue_lines_materialIssueId_material_issues",
      indexName: "idx_material_issue_lines_materialIssueId",
    },
    {
      table: "material_return_lines",
      column: "materialReturnId",
      refTable: "material_returns",
      refColumn: "id",
      constraintName: "fk_material_return_lines_materialReturnId_material_returns",
      indexName: "idx_material_return_lines_materialReturnId",
    },
    {
      table: "production_processing",
      column: "productionId",
      refTable: "productions",
      refColumn: "id",
      constraintName: "fk_production_processing_productionId_productions",
      indexName: "idx_production_processing_productionId",
    },
  ];

  for (const def of defs) {
    await ensureForeignKey(db, database, def);
  }
}

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

const NPD_LINKED_TABLES = new Set([
  "orders",
  "productions",
  "invoice_line_items",
  "sample_requests",
  "consumptions",
]);

function toFiniteNumber(value: any): number | undefined {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrEmpty(value: any) {
  return String(value ?? "").trim();
}

function normalizeSyncStatus(value: any) {
  return stringOrEmpty(value).toLowerCase() === "removed" ? "removed" : "active";
}

function normalizeSheetCellValue(key: string, value: any) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  if (NPD_SYNC_NUMERIC_KEYS.has(key)) {
    const numericValue = Number(trimmed.replace(/,/g, ""));
    if (Number.isFinite(numericValue)) return numericValue;
  }

  return trimmed;
}

function mapSheetRowByHeaderMap_(
  row: Record<string, any>,
  headerMap: Record<string, string>,
  numericKeys: Set<string> = new Set()
) {
  const mapped: Record<string, any> = {};

  Object.entries(headerMap).forEach(([header, key]) => {
    if (!Object.prototype.hasOwnProperty.call(row, header)) return;
    const normalizedValue = normalizeSheetCellValue(key, row[header]);
    if (numericKeys.has(key) || normalizedValue !== null) {
      mapped[key] = normalizedValue;
    }
  });

  return mapped;
}

function mapSheetRowToNpdRow(row: Record<string, any>) {
  const mapped = mapSheetRowByHeaderMap_(row, NPD_SYNC_HEADER_MAP as Record<string, string>, NPD_SYNC_NUMERIC_KEYS);
  mapped.npdId = stringOrEmpty(mapped.npdId);
  return mapped;
}

function resolveSheetSyncBusinessKey_(config: any, mappedRow: Record<string, any>) {
  if (!config || !mappedRow) return "";

  if (config.table === "npd") {
    const erp = stringOrEmpty(mappedRow.erp);
    if (erp) return `erp:${erp}`;
  }

  return stringOrEmpty(mappedRow[config.idColumn]);
}

function normalizeSyncIdList(values: any) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => stringOrEmpty(value)).filter((value) => value !== ""))];
}

function resolveLinkedNpdId(value: any) {
  const npdId = stringOrEmpty(value?.npdId);
  if (npdId) return npdId;
  const itemId = stringOrEmpty(value?.itemId);
  if (itemId) return itemId;
  return "";
}

function normalizeOrderItemSourceValue(value: any) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PHP") return "PHP";
  if (normalized === "PLATE") return "PLATE";
  return "FG";
}

function normalizeMaterialLineNpdLink(line: any) {
  const resolvedId = resolveLinkedNpdId(line);
  return {
    ...line,
    npdId: resolvedId || undefined,
    itemId: resolvedId || line?.itemId,
  };
}

function normalizeNpdLinkedPayload(tableName: string, data: any) {
  if (tableName === "orders") {
    const itemSource = normalizeOrderItemSourceValue(data?.itemSource);
    data.itemSource = itemSource;

    if (itemSource === "FG") {
      const resolvedId = resolveLinkedNpdId(data);
      if (resolvedId) {
        data.npdId = resolvedId;
        data.itemId = resolvedId;
      }
    } else {
      delete data.npdId;
      data.itemId = stringOrEmpty(data?.itemId);
    }
  } else if (NPD_LINKED_TABLES.has(tableName)) {
    const resolvedId = resolveLinkedNpdId(data);
    if (resolvedId) {
      data.npdId = resolvedId;
      data.itemId = resolvedId;
    }
  }

  if (tableName === "material_in" && Array.isArray(data.lines)) {
    data.lines = data.lines.map((line: any) => normalizeMaterialLineNpdLink(line));
  }

  return data;
}

function normalizeNpdRowForItemConsumers(row: any) {
  const resolvedId = stringOrEmpty(row?.id || resolveLinkedNpdId(row));
  const opening = toFiniteNumber(row?.opening) ?? 0;
  const receipt = toFiniteNumber(row?.receipt) ?? 0;
  const production = toFiniteNumber(row?.production) ?? 0;
  const invoiced = toFiniteNumber(row?.invoiced) ?? 0;
  const balance = toFiniteNumber(row?.balance) ?? opening + receipt + production - invoiced;
  const syncStatus = normalizeSyncStatus(row?.syncStatus);

  return {
    ...row,
    id: resolvedId,
    npdId: resolvedId || undefined,
    itemId: resolvedId || undefined,
    name: row?.name ?? row?.itemName ?? "",
    customer: row?.customer ?? row?.customerName ?? "",
    itemType: row?.itemType ?? row?.boxType ?? "",
    typeName: row?.typeName ?? row?.boxType ?? "",
    openLength: row?.openLength ?? toFiniteNumber(row?.openLength),
    openWidth: row?.openWidth ?? toFiniteNumber(row?.openWidth),
    length: row?.length ?? toFiniteNumber(row?.lengthId),
    breadth: row?.breadth ?? toFiniteNumber(row?.breadthId),
    height: row?.height ?? toFiniteNumber(row?.heightId),
    flute: row?.flute ?? row?.fluteType ?? "",
    lOd: row?.lOd ?? toFiniteNumber(row?.lengthOd),
    wOd: row?.wOd ?? toFiniteNumber(row?.breadthOd),
    hOd: row?.hOd ?? toFiniteNumber(row?.heightOd),
    l1: row?.l1 ?? toFiniteNumber(row?.psL1),
    f1: row?.f1 ?? toFiniteNumber(row?.psF1),
    l2: row?.l2 ?? toFiniteNumber(row?.psL2),
    f2: row?.f2 ?? toFiniteNumber(row?.psF2),
    l3: row?.l3 ?? toFiniteNumber(row?.psL3),
    f3: row?.f3 ?? toFiniteNumber(row?.rsf4),
    b3: row?.b3 ?? toFiniteNumber(row?.rsl5),
    flap: row?.flap ?? toFiniteNumber(row?.flapSize),
    takeUpFactor: row?.takeUpFactor ?? toFiniteNumber(row?.takeUpFactor),
    plateWeight:
      row?.plateWeight ??
      (() => {
        const platePhpWeight = toFiniteNumber(row?.platePhpWeight);
        return platePhpWeight === undefined ? undefined : platePhpWeight / 1000;
      })(),
    artwork: row?.artwork ?? row?.artworkUpload ?? "",
    opening,
    receipt,
    production,
    invoiced,
    balance,
    syncStatus,
  };
}

function normalizeFetchedRow(tableName: string, row: any) {
  const newRow = normalizeWorkflowStatus(tableName, row);

  Object.keys(newRow).forEach((key) => {
    if (key === "lines" && typeof newRow[key] === "string") {
      try {
        newRow[key] = JSON.parse(newRow[key]);
      } catch (e) {
        console.error(`Failed to parse JSON for column ${key} in table ${tableName}:`, e);
      }
    }
  });

    if (tableName === "gate_passes") {
      const schemaName = process.env.DB_NAME || "u380633007_Inpidata";
    newRow.loadingSlipIds = normalizeStringArray(newRow.loadingSlipIds);
    newRow.loadingSlipNos = normalizeStringArray(newRow.loadingSlipNos);
    if (!Array.isArray(newRow.lines)) newRow.lines = [];
  }

  if (tableName === "material_in" && Array.isArray(newRow.lines)) {
    newRow.lines = newRow.lines.map((line: any) => normalizeMaterialLineNpdLink(line));
  }

  if (tableName === "orders") {
    newRow.itemSource = normalizeOrderItemSourceValue(newRow.itemSource);
    if (newRow.itemSource === "FG") {
      const resolvedId = resolveLinkedNpdId(newRow);
      if (resolvedId) {
        newRow.npdId = resolvedId;
        newRow.itemId = resolvedId;
      }
    }
  } else if (NPD_LINKED_TABLES.has(tableName)) {
    const resolvedId = resolveLinkedNpdId(newRow);
    if (resolvedId) {
      newRow.npdId = resolvedId;
      newRow.itemId = resolvedId;
    }
  }

  if (tableName === "items" || tableName === "npd") {
    return normalizeNpdRowForItemConsumers(newRow);
  }

  if (tableName === "users") {
    newRow.userId = String(newRow.userId || newRow.userid || newRow.user_id || "").trim();
    newRow.updatedBy = String(newRow.updatedBy || newRow.updated_by || "").trim();
    newRow.updateTimestamp = String(newRow.updateTimestamp || newRow.update_timestamp || "").trim();
    if (newRow.menuAccess === undefined && newRow.menuaccess !== undefined) {
      newRow.menuAccess = newRow.menuaccess;
    }
    newRow.role = normalizeUserRole(newRow.role);
    newRow.menuAccess = normalizeMenuAccess(newRow.menuAccess);
  }

  if (tableName === "machines") {
    newRow.assignedOperatorIds = normalizeStringArray(newRow.assignedOperatorIds);
    newRow.assignedOperatorNames = normalizeStringArray(newRow.assignedOperatorNames);
  }

  return newRow;
}

async function fetchLegacyItems(db: mysql.Pool) {
  const [rows] = await db.query(`
    SELECT
      i.*,
      CAST(COALESCE(i.opening, 0) AS DECIMAL(15,2)) AS opening,
      CAST(COALESCE(r.receipt, 0) AS DECIMAL(15,2)) AS receipt,
      CAST(COALESCE(p.production, 0) AS DECIMAL(15,2)) AS production,
      CAST(COALESCE(inv.invoiced, 0) AS DECIMAL(15,2)) AS invoiced,
      CAST(
        COALESCE(i.opening, 0)
        + COALESCE(r.receipt, 0)
        + COALESCE(p.production, 0)
        - COALESCE(inv.invoiced, 0)
      AS DECIMAL(15,2)) AS balance
    FROM \`items\` i
    LEFT JOIN (
      SELECT
        jt.itemId,
        SUM(COALESCE(jt.invoiceQty, jt.qty, 0)) AS receipt
      FROM \`material_in\` mi
      JOIN JSON_TABLE(
        mi.lines,
        '$[*]' COLUMNS (
          itemId VARCHAR(36) PATH '$.itemId',
          qty DECIMAL(15,2) PATH '$.qty',
          invoiceQty DECIMAL(15,2) PATH '$.invoiceQty',
          rate DECIMAL(15,2) PATH '$.rate',
          invoiceRate DECIMAL(15,2) PATH '$.invoiceRate'
        )
      ) jt
      WHERE mi.status = 'Completed' AND mi.mrrType IN ('Rejection In', 'FG Purchase')
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

  return (rows as any[]).map((row) => normalizeWorkflowStatus("items", row));
}

async function fetchActiveNpdItems(
  db: mysql.Pool,
  options?: { search?: string; limit?: number; offset?: number; includeTotal?: boolean; status?: "active" | "removed" | "all" }
) {
  const [npdColumnsRows] = await db.query("SHOW COLUMNS FROM `npd`");
  const npdColumns = new Set((npdColumnsRows as any[]).map((row) => String(row.Field || "").trim()));
  const openingExpr = npdColumns.has("opening") ? "COALESCE(n.opening, 0)" : "0";
  const requestedStatus = String(options?.status || "active").trim().toLowerCase();
  const syncStatusExpr = "COALESCE(NULLIF(TRIM(n.syncStatus), ''), 'active')";
  const syncStatusFilter = !npdColumns.has("syncStatus")
    ? "1 = 1"
    : requestedStatus === "removed"
      ? `${syncStatusExpr} = 'removed'`
      : requestedStatus === "all"
        ? "1 = 1"
        : `${syncStatusExpr} <> 'removed'`;
  const search = String(options?.search || "").trim();
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Number(options?.limit)) : undefined;
  const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options?.offset)) : 0;
  const whereClauses = [syncStatusFilter];
  const params: any[] = [];

  if (search) {
    const like = `%${search}%`;
    whereClauses.push(`(
      n.npdId LIKE ?
      OR n.itemName LIKE ?
      OR n.customerName LIKE ?
      OR n.companyId LIKE ?
      OR n.poNumber LIKE ?
      OR n.erp LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }

  const whereSql = `WHERE ${whereClauses.join(" AND ")}`;
  const orderSql = "ORDER BY COALESCE(NULLIF(TRIM(n.updateTimestamp), ''), NULLIF(TRIM(n.timestamp), ''), NULLIF(TRIM(n.date), '')) DESC, n.npdId ASC";
  const limitSql = limit ? " LIMIT ? OFFSET ?" : "";

  const [rows] = await db.query(
    `
    SELECT
      n.*,
      CAST(${openingExpr} AS DECIMAL(15,2)) AS opening,
      CAST(COALESCE(r.receipt, 0) AS DECIMAL(15,2)) AS receipt,
      CAST(COALESCE(p.production, 0) AS DECIMAL(15,2)) AS production,
      CAST(COALESCE(inv.invoiced, 0) AS DECIMAL(15,2)) AS invoiced,
      CAST(
        ${openingExpr}
        + COALESCE(r.receipt, 0)
        + COALESCE(p.production, 0)
        - COALESCE(inv.invoiced, 0)
      AS DECIMAL(15,2)) AS balance
    FROM \`npd\` n
    LEFT JOIN (
      SELECT
        COALESCE(NULLIF(jt.npdId, ''), jt.itemId) AS masterId,
        SUM(COALESCE(jt.invoiceQty, jt.qty, 0)) AS receipt
      FROM \`material_in\` mi
      JOIN JSON_TABLE(
        mi.lines,
        '$[*]' COLUMNS (
          npdId VARCHAR(36) PATH '$.npdId',
          itemId VARCHAR(36) PATH '$.itemId',
          qty DECIMAL(15,2) PATH '$.qty',
          invoiceQty DECIMAL(15,2) PATH '$.invoiceQty'
        )
      ) jt
      WHERE mi.status = 'Completed' AND mi.mrrType IN ('Rejection In', 'FG Purchase')
      GROUP BY COALESCE(NULLIF(jt.npdId, ''), jt.itemId)
    ) r ON r.masterId COLLATE utf8mb4_unicode_ci = n.id COLLATE utf8mb4_unicode_ci
    LEFT JOIN (
      SELECT
        COALESCE(NULLIF(npdId, ''), itemId) AS masterId,
        SUM(COALESCE(prodFromFFG, 0)) AS production
      FROM \`productions\`
      WHERE status <> 'Cancelled' OR status IS NULL
      GROUP BY COALESCE(NULLIF(npdId, ''), itemId)
    ) p ON p.masterId COLLATE utf8mb4_unicode_ci = n.id COLLATE utf8mb4_unicode_ci
    LEFT JOIN (
      SELECT
        COALESCE(NULLIF(npdId, ''), itemId) AS masterId,
        SUM(COALESCE(qty, 0)) AS invoiced
      FROM \`invoice_line_items\`
      GROUP BY COALESCE(NULLIF(npdId, ''), itemId)
    ) inv ON inv.masterId COLLATE utf8mb4_unicode_ci = n.id COLLATE utf8mb4_unicode_ci
    ${whereSql}
    ${orderSql}
    ${limitSql}
  `,
    limit ? [...params, limit, offset] : params
  );

  const normalizedRows = (rows as any[]).map((row) => normalizeNpdRowForItemConsumers(row));
  if (!options?.includeTotal) {
    return normalizedRows;
  }

  const [countRows] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM \`npd\` n
    ${whereSql}
  `,
    params
  );

  return {
    rows: normalizedRows,
    total: Number((countRows as any[])?.[0]?.total || 0),
  };
}

function normalizeItemLookupId(value: any) {
  return stringOrEmpty(value?.npdId || value?.itemId || value);
}

function normalizeComparableName(value: any) {
  return stringOrEmpty(value).replace(/\s+/g, " ").toLowerCase();
}

async function ensureColumnExists(db: mysql.Pool, database: string, table: string, column: string, type: string) {
  const [rows] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [database, table, column]
  );
  if ((rows as any[]).length > 0) return;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`);
}

async function ensureCompaniesSchemaColumns(db: mysql.Pool, database: string) {
  for (const { column, type } of COMPANY_SCHEMA_COLUMNS) {
    await ensureColumnExists(db, database, "companies", column, type);
  }
}

async function ensureGatePassNullableColumns(db: mysql.Pool, database: string) {
  const nullableColumns = [
    { column: "invoiceId", type: "VARCHAR(36) NULL" },
    { column: "invoiceNo", type: "VARCHAR(100) NULL" },
    { column: "companyId", type: "VARCHAR(36) NULL" },
    { column: "companyName", type: "VARCHAR(255) NULL" },
  ];

  for (const { column, type } of nullableColumns) {
    const [rows] = await db.query(
      "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [database, "gate_passes", column]
    );
    const metadata = (rows as any[])[0];
    if (!metadata) continue;
    if (String(metadata.IS_NULLABLE || "").toUpperCase() === "YES") continue;

    console.log(`[DB] Relaxing gate_passes.${column} to nullable for returnable gate pass compatibility...`);
    await db.query(`ALTER TABLE \`gate_passes\` MODIFY COLUMN \`${column}\` ${type}`);
  }
}

async function getExistingColumnNames(db: mysql.Pool, database: string, table: string) {
  const [rows] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    [database, table]
  );
  return new Set((rows as any[]).map((row) => String(row.COLUMN_NAME || "")));
}

async function ensureUsersCanonicalData(db: mysql.Pool, database: string) {
  const columns = await getExistingColumnNames(db, database, "users");

  if (columns.has("userId")) {
    const userIdSources = ["userid", "user_id"].filter((column) => columns.has(column));
    if (userIdSources.length > 0) {
      const expr = userIdSources.map((column) => `NULLIF(TRIM(\`${column}\`), '')`).join(", ");
      await db.query(
        `UPDATE \`users\` SET \`userId\` = COALESCE(NULLIF(TRIM(\`userId\`), ''), ${expr}) WHERE COALESCE(NULLIF(TRIM(\`userId\`), ''), '') = ''`
      );
    }
  }

  if (columns.has("updatedBy")) {
    const updatedBySources = ["updated_by"].filter((column) => columns.has(column));
    if (updatedBySources.length > 0) {
      const expr = updatedBySources.map((column) => `NULLIF(TRIM(\`${column}\`), '')`).join(", ");
      await db.query(
        `UPDATE \`users\` SET \`updatedBy\` = COALESCE(NULLIF(TRIM(\`updatedBy\`), ''), ${expr}) WHERE COALESCE(NULLIF(TRIM(\`updatedBy\`), ''), '') = ''`
      );
    }
  }

  if (columns.has("updateTimestamp")) {
    const updateTimestampSources = ["update_timestamp"].filter((column) => columns.has(column));
    if (updateTimestampSources.length > 0) {
      const expr = updateTimestampSources.map((column) => `NULLIF(TRIM(\`${column}\`), '')`).join(", ");
      await db.query(
        `UPDATE \`users\` SET \`updateTimestamp\` = COALESCE(NULLIF(TRIM(\`updateTimestamp\`), ''), ${expr}) WHERE COALESCE(NULLIF(TRIM(\`updateTimestamp\`), ''), '') = ''`
      );
    }
  }

  if (columns.has("menuAccess") && columns.has("menuaccess")) {
    await db.query(
      "UPDATE `users` SET `menuAccess` = COALESCE(`menuAccess`, `menuaccess`) WHERE `menuAccess` IS NULL"
    );
  }
}

async function ensureNpdSchemaColumns(db: mysql.Pool, database: string) {
  for (const { column, type } of NPD_SCHEMA_COLUMNS) {
    await ensureColumnExists(db, database, "npd", column, type);
  }
}

async function ensureSheetMasterSchemaColumns(
  db: mysql.Pool,
  database: string,
  table: string,
  schemaColumns: Array<{ column: string; type: string }>
) {
  for (const { column, type } of schemaColumns) {
    await ensureColumnExists(db, database, table, column, type);
  }
}

async function buildItemToNpdIdMap(db: mysql.Pool) {
  const [npdRows] = await db.query("SELECT id, itemName, erp FROM `npd`");

  const mapping = new Map<string, string>();

  (npdRows as any[]).forEach((row) => {
    const npdId = String(row.id || "").trim();
    if (npdId) {
      mapping.set(npdId, npdId);
    }
  });

  return mapping;
}

async function migrateLinkedTableToNpd(db: mysql.Pool, database: string, table: string, itemToNpdId: Map<string, string>) {
  await ensureColumnExists(db, database, table, "npdId", "VARCHAR(36) NULL");

  const [rows] = await db.query(`SELECT id, itemId, npdId FROM \`${table}\``);
  let migrated = 0;
  let unmatched = 0;

  for (const row of rows as any[]) {
    const currentLegacyId = stringOrEmpty(row.itemId);
    const currentNpdId = stringOrEmpty(row.npdId);
    const resolvedNpdId = currentNpdId || itemToNpdId.get(currentLegacyId) || "";

    if (!resolvedNpdId) {
      if (currentLegacyId) unmatched += 1;
      continue;
    }

    if (currentNpdId === resolvedNpdId && currentLegacyId === resolvedNpdId) continue;

    await db.query(`UPDATE \`${table}\` SET \`npdId\` = ?, \`itemId\` = ? WHERE \`id\` = ?`, [
      resolvedNpdId,
      resolvedNpdId,
      String(row.id),
    ]);
    migrated += 1;
  }

  console.log(`[DB] ${table}: migrated ${migrated} item links to NPD, unmatched ${unmatched}`);
}

async function migrateMaterialInLinesToNpd(db: mysql.Pool, itemToNpdId: Map<string, string>) {
  const [rows] = await db.query("SELECT id, lines FROM `material_in`");
  let migrated = 0;
  let unmatched = 0;

  for (const row of rows as any[]) {
    const rawLines = typeof row.lines === "string" ? JSON.parse(row.lines) : row.lines;
    if (!Array.isArray(rawLines)) continue;

    let changed = false;
    const nextLines = rawLines.map((line) => {
      const currentItemId = stringOrEmpty(line?.itemId);
      const currentNpdId = stringOrEmpty(line?.npdId);
      const resolvedNpdId = currentNpdId || itemToNpdId.get(currentItemId) || "";

      if (!resolvedNpdId) {
        if (currentItemId) unmatched += 1;
        return line;
      }

      if (currentNpdId === resolvedNpdId && currentItemId === resolvedNpdId) return line;
      changed = true;
      migrated += 1;
      return {
        ...line,
        npdId: resolvedNpdId,
        itemId: resolvedNpdId,
      };
    });

    if (!changed) continue;
    await db.query("UPDATE `material_in` SET `lines` = ? WHERE `id` = ?", [JSON.stringify(nextLines), String(row.id)]);
  }

  console.log(`[DB] material_in: migrated ${migrated} JSON item links to NPD, unmatched ${unmatched}`);
}

async function migrateItemMasterLinksToNpd(db: mysql.Pool, database: string) {
  const itemToNpdId = await buildItemToNpdIdMap(db);
  if (itemToNpdId.size === 0) {
    console.warn("[DB] No Item-to-NPD mappings were discovered. Skipping NPD link migration.");
    return;
  }

  for (const table of ["orders", "productions", "invoice_line_items", "sample_requests", "consumptions"]) {
    await migrateLinkedTableToNpd(db, database, table, itemToNpdId);
  }

  await migrateMaterialInLinesToNpd(db, itemToNpdId);
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

function normalizeMachineName(name?: string | null) {
  const trimmed = String(name || "").trim();
  if (trimmed === "Corrugation Finger") return "Corrugation Paper";
  if (trimmed === "Corrugation Linear") return "Corrugation Liner";
  return trimmed;
}

function parseMandatoryMachinesByType(setting?: any | null): Record<string, string[]> {
  const raw = setting?.mandatoryMachinesByType;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    const normalized: Record<string, string[]> = {};
    for (const [typeName, value] of entries) {
      if (!typeName || typeof typeName !== "string") continue;
      const list = Array.isArray(value) ? value : [];
      const machines = list
        .map((v) => normalizeMachineName(String(v || "")).trim())
        .filter(Boolean);
      normalized[typeName.trim()] = Array.from(new Set(machines));
    }
    return normalized;
  } catch {
    return {};
  }
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

async function loadAuthUserById(userId: string): Promise<AuthUser | null> {
  const db = await getPool();
  if (!db) return null;
  const [rows] = await db.query("SELECT * FROM `users` WHERE id = ? LIMIT 1", [userId]);
  const rawRow = (rows as any[])[0];
  if (!rawRow) return null;
  const row = normalizeFetchedRow("users", rawRow);
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.userId || ""),
    name: String(row.name || ""),
    email: row.email ? String(row.email) : null,
    role: normalizeUserRole(row.role),
    status: String(row.status || "Active") === "Inactive" ? "Inactive" : "Active",
    menuAccess: normalizeMenuAccess(row.menuAccess),
  };
}

async function ensureDevSeedUser(db: mysql.Pool) {
  const userId = "system@lngrp.in";
  const password = "abcd";

  const [rows] = await db.query("SELECT id FROM `users` WHERE userId = ? OR email = ? LIMIT 1", [userId, userId]);
  const existing = (rows as any[])[0];
  if (existing?.id) return;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const seed = {
    id,
    userId,
    name: "System Admin",
    mobile: "",
    email: userId,
    password,
    role: "Admin",
    status: "Active",
    menuAccess: JSON.stringify(["*"]),
    updatedBy: "System",
    updateTimestamp: now,
  };

  const keys = Object.keys(seed);
  const values = Object.values(seed);
  const placeholders = keys.map(() => "?").join(",");
  const columnNames = keys.map((k) => `\`${k}\``).join(",");
  await db.query(`INSERT INTO \`users\` (${columnNames}) VALUES (${placeholders})`, values);
  console.log("[DB] Seeded dev admin user:", userId);
}

async function getRequestUser(req: express.Request): Promise<AuthUser | null> {
  const id = String((req as any).authUserId || "");
  if (!id) return null;
  return await loadAuthUserById(id);
}

function entityPermissionKey(entity: string): string {
  switch (entity) {
    case "users":
      return "/masters/users";
    case "item_groups":
      return "/masters/item-groups";
    case "material_groups":
      return "/masters/material-groups";
    case "items":
      return "/masters/items";
    case "materials":
      return "/masters/materials";
    case "suppliers":
      return "/masters/suppliers";
    case "states":
      return "/masters/states";
    case "units":
      return "/masters/units";
    case "color_masters":
      return "/masters/colors";
    case "companies":
      return "/masters/companies";
    case "trucks":
      return "/masters/trucks";
    case "machines":
      return "/masters/machines";
    case "npd":
      return "/masters/npd";
    case "php_item_master":
      return "/masters/php-item-master";
    case "plate_item_master":
      return "/masters/plate-item-master";
    case "settings":
      return "/masters/settings";
    case "material_in":
    case "material_in_packing_slips":
      return "/material-in";
    case "indent_lines":
    case "indents":
      return "/indent";
    case "purchase_orders":
    case "purchase_order_lines":
      return "/purchase-orders";
    case "gate_entries":
    case "gate_entry_photos":
      return "/gate-entry";
    case "material_issues":
    case "material_issue_lines":
    case "material_issue_reel_lines":
    case "material_returns":
    case "material_return_lines":
    case "material_return_reel_lines":
    case "consumptions":
      return "/material-movement";
    case "orders":
    case "orders_schedule":
      return "/orders";
    case "productions":
      return "/production";
    case "production_processing":
      return "/production-processing";
    case "sample_requests":
      return "/samples";
    case "dispatch_plans":
      return "/dispatch";
    case "loading_slips":
      return "/loading";
    case "gate_passes":
      return "/gate-pass";
    case "material_visit":
      return "/material-visit";
    case "invoices":
    case "invoice_line_items":
      return "/billing";
    case "realization_rate_chart":
      return "/reports";
    default:
      return "";
  }
}

type InvoiceNumberSeriesConfig = {
  fy: string;
  prefix: string;
  startingNumber: number;
  paddingLength: number;
  separator: string;
  active: string;
};

function getShortFinancialYear(dateStr?: string) {
  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 3) {
    return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
  }
  return `${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
}

function parseInvoiceNumberSeries(raw: unknown): InvoiceNumberSeriesConfig[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        fy: String((row as any)?.fy || "").trim(),
        prefix: String((row as any)?.prefix || "").trim(),
        startingNumber: Math.max(1, Number((row as any)?.startingNumber || 1)),
        paddingLength: Math.max(1, Number((row as any)?.paddingLength || 5)),
        separator: String((row as any)?.separator || "/") || "/",
        active: String((row as any)?.active || "Yes").trim() || "Yes",
      }))
      .filter((row) => row.fy && row.prefix);
  } catch {
    return [];
  }
}

function escapeLikePattern(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildInvoiceNumber(prefix: string, fy: string, separator: string, nextNumber: number, paddingLength: number) {
  return `${prefix}${separator}${fy}${separator}${String(nextNumber).padStart(paddingLength, "0")}`;
}

async function generateDynamicInvoiceNo(db: mysql.Pool, dateStr?: string) {
  const fy = getShortFinancialYear(dateStr);
  if (!fy) throw new Error("Invoice date is invalid for invoice series generation.");

  const [settingsRows] = await db.query("SELECT invoiceNumberSeries FROM `settings` LIMIT 1");
  const settingsRow = (settingsRows as any[])[0] || {};
  const seriesRows = parseInvoiceNumberSeries(settingsRow.invoiceNumberSeries);
  const series = seriesRows.find(
    (row) => row.fy === fy && String(row.active || "Yes").toLowerCase() === "yes"
  );

  if (!series) {
    throw new Error(`Invoice numbering series not configured for FY ${fy}.`);
  }

  const separator = series.separator || "/";
  const prefix = series.prefix.trim();
  const startingNumber = Math.max(1, Number(series.startingNumber || 1));
  const paddingLength = Math.max(1, Number(series.paddingLength || 5));
  const likePattern = `${escapeLikePattern(prefix)}${escapeLikePattern(separator)}${escapeLikePattern(fy)}${escapeLikePattern(separator)}%`;

  const [invoiceRows] = await db.query(
    "SELECT invoiceNo FROM `invoices` WHERE invoiceNo LIKE ? ESCAPE '\\\\'",
    [likePattern]
  );

  let lastNumber = startingNumber - 1;
  for (const row of invoiceRows as any[]) {
    const invoiceNo = String(row?.invoiceNo || "").trim();
    const expectedPrefix = `${prefix}${separator}${fy}${separator}`;
    if (!invoiceNo.startsWith(expectedPrefix)) continue;
    const suffix = invoiceNo.slice(expectedPrefix.length).trim();
    const parsedNumber = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsedNumber) && parsedNumber > lastNumber) {
      lastNumber = parsedNumber;
    }
  }

  return buildInvoiceNumber(prefix, fy, separator, lastNumber + 1, paddingLength);
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
          \`color\` VARCHAR(255),
          \`size\` DECIMAL(15,2),
          \`gsm\` DECIMAL(15,2),
          \`bf\` DECIMAL(15,2),
          \`openingQty\` DECIMAL(15,2),
          \`openingRate\` DECIMAL(15,2),
          \`openingValue\` DECIMAL(15,2),
          \`remarks\` TEXT,
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`tallyTimestamp\` VARCHAR(255),
          \`tallyMaterialId\` VARCHAR(255),
          \`tallySyncRemark\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`tally_change_log\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`material_id\` VARCHAR(36),
          \`item_name\` VARCHAR(255),
          \`erp_code\` VARCHAR(100),
          \`tally_material_id\` VARCHAR(255),
          \`action\` VARCHAR(100),
          \`remark\` TEXT,
          \`status\` VARCHAR(50),
          \`error_message\` TEXT,
          \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`indents\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`indentNo\` VARCHAR(30),
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
          \`targetDeliveryDate\` VARCHAR(50),
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
          \`indentId\` VARCHAR(36),
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

      // Migration: Make indentId nullable in purchase_orders if it exists but is NOT NULL
      try {
        const [columns] = await db.query(
          "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'indentId'",
          [database]
        );
        if ((columns as any[]).length > 0 && (columns as any[])[0].IS_NULLABLE === "NO") {
          console.log("[DB] Making purchase_orders.indentId nullable...");
          await db.query("ALTER TABLE `purchase_orders` MODIFY `indentId` VARCHAR(36) NULL");
        }
      } catch (err) {
        console.warn("[DB] Could not make purchase_orders.indentId nullable:", (err as Error).message);
      }

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
          \`targetDeliveryDate\` VARCHAR(50),
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
          \`purpose\` VARCHAR(50),
          \`invoiceNo\` VARCHAR(100) NOT NULL,
          \`invoiceValue\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`truckNo\` VARCHAR(100) NOT NULL,
          \`sourceGatePassId\` VARCHAR(36),
          \`sourceGatePassNo\` VARCHAR(100),
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
        CREATE TABLE IF NOT EXISTS \`material_in_packing_slips\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`materialInId\` VARCHAR(36) NOT NULL,
          \`materialLineId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`supplierReelNo\` VARCHAR(255),
          \`ourReelNo\` VARCHAR(100) NOT NULL,
          \`weightKg\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`supplierPoNo\` VARCHAR(255),
          \`ourPoId\` VARCHAR(36),
          \`ourPoNo\` VARCHAR(100),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_issues\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`issueNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`issueType\` VARCHAR(50) NOT NULL,
          \`productionId\` VARCHAR(36),
          \`jobNo\` VARCHAR(100),
          \`remarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_issue_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`materialIssueId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`uom\` VARCHAR(50) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_issue_reel_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`materialIssueId\` VARCHAR(36) NOT NULL,
          \`materialIssueLineId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`packingSlipId\` VARCHAR(36) NOT NULL,
          \`ourReelNo\` VARCHAR(100) NOT NULL,
          \`weightKg\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`productionId\` VARCHAR(36) NOT NULL,
          \`jobNo\` VARCHAR(100) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_returns\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`returnNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`returnType\` VARCHAR(50) NOT NULL,
          \`productionId\` VARCHAR(36),
          \`jobNo\` VARCHAR(100),
          \`remarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_return_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`materialReturnId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`qty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`uom\` VARCHAR(50) NOT NULL,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_return_reel_lines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`materialReturnId\` VARCHAR(36) NOT NULL,
          \`materialReturnLineId\` VARCHAR(36) NOT NULL,
          \`materialId\` VARCHAR(36) NOT NULL,
          \`packingSlipId\` VARCHAR(36) NOT NULL,
          \`ourReelNo\` VARCHAR(100) NOT NULL,
          \`weightKg\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`productionId\` VARCHAR(36) NOT NULL,
          \`jobNo\` VARCHAR(100) NOT NULL,
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
          \`gstSupplyType\` VARCHAR(20) DEFAULT 'INTRA_STATE',
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
        CREATE TABLE IF NOT EXISTS \`units\` (
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
          \`itemSource\` VARCHAR(20) NOT NULL DEFAULT 'FG',
          \`npdId\` VARCHAR(36),
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`rate\` DECIMAL(15,2),
          \`orderAmount\` DECIMAL(15,2) DEFAULT 0,
          \`orderBy\` VARCHAR(255),
          \`poType\` VARCHAR(50),
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending PH',
          \`approvedTimestamp\` VARCHAR(255),
          \`approvedEmail\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`realization_rate_chart\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`dateFrom\` VARCHAR(50) NOT NULL,
          \`dateTo\` VARCHAR(50) NOT NULL,
          \`realizationRate\` DECIMAL(15,2) NOT NULL DEFAULT 0,
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
          \`gstSupplyType\` VARCHAR(20) DEFAULT 'INTRA_STATE',
          \`deviationAllowed\` DECIMAL(10,2),
          \`toleranceAllowed\` DECIMAL(10,2),
          \`syncSource\` VARCHAR(50),
          \`syncStatus\` VARCHAR(20) DEFAULT 'active',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255),
          \`gstType\` VARCHAR(50),
          \`panNo\` VARCHAR(50),
          \`pin\` VARCHAR(20),
          \`npdHostingerSync\` VARCHAR(255),
          \`salesPerson\` VARCHAR(255)
        )
      `);

      // Migration: Add new columns to companies table
      try {
        const [columns] = await db.query(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'companies'",
          [database]
        );
        const existingColumns = (columns as any[]).map((c: any) => c.COLUMN_NAME);
        
        if (!existingColumns.includes("gstType")) {
          console.log("[DB] Adding gstType to companies...");
          await db.query("ALTER TABLE \`companies\` ADD COLUMN \`gstType\` VARCHAR(50)");
        }
        if (!existingColumns.includes("panNo")) {
          console.log("[DB] Adding panNo to companies...");
          await db.query("ALTER TABLE \`companies\` ADD COLUMN \`panNo\` VARCHAR(50)");
        }
        if (!existingColumns.includes("pin")) {
          console.log("[DB] Adding pin to companies...");
          await db.query("ALTER TABLE \`companies\` ADD COLUMN \`pin\` VARCHAR(20)");
        }
        if (!existingColumns.includes("npdHostingerSync")) {
          console.log("[DB] Adding npdHostingerSync to companies...");
          await db.query("ALTER TABLE \`companies\` ADD COLUMN \`npdHostingerSync\` VARCHAR(255)");
        }
        if (!existingColumns.includes("salesPerson")) {
          console.log("[DB] Adding salesPerson to companies...");
          await db.query("ALTER TABLE \`companies\` ADD COLUMN \`salesPerson\` VARCHAR(255)");
        }
      } catch (err) {
        console.warn("[DB] Could not alter companies table:", (err as Error).message);
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`machines\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`maxOutputPerHour\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`assignedOperatorIds\` JSON,
          \`assignedOperatorNames\` JSON,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`gst_rate_masters\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`rate\` DECIMAL(5,2) NOT NULL DEFAULT 0,
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_in\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`mrrType\` VARCHAR(50),
          \`gateEntryId\` VARCHAR(36),
          \`gateEntryNo\` VARCHAR(100),
          \`sourceGatePassId\` VARCHAR(36),
          \`sourceGatePassNo\` VARCHAR(100),
          \`timestamp\` VARCHAR(255) NOT NULL,
          \`entryEmailId\` VARCHAR(255) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`invoiceNo\` VARCHAR(100),
          \`invDate\` VARCHAR(50),
          \`supplierId\` VARCHAR(36) NOT NULL,
          \`totalPoValue\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalInvoiceValue\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalActualValue\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalCgst\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalSgst\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalIgst\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalInvoiceValueAfterGst\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`insurance\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`otherCharges\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`roundOff\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
          \`totalAmount\` DECIMAL(15, 2) NOT NULL,
          \`lines\` JSON NOT NULL,
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`plant_head_remark\` TEXT,
          \`accTimestamp\` VARCHAR(255),
          \`accEmailId\` VARCHAR(255),
          \`accounts_remark\` TEXT,
          \`debitNote\` VARCHAR(255),
          \`debitNoteDate\` VARCHAR(50),
          \`debitNoteAmount\` DECIMAL(15,2),
          \`mdTimestamp\` VARCHAR(255),
          \`mdEmailId\` VARCHAR(255),
          \`md_approval_remark\` TEXT,
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
          \`designation\` VARCHAR(255),
          \`role\` VARCHAR(20) NOT NULL DEFAULT 'Employee',
          \`status\` VARCHAR(20) NOT NULL DEFAULT 'Active',
          \`menuAccess\` JSON,
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
          \`parentProductionId\` VARCHAR(36),
          \`itemSource\` VARCHAR(20) NOT NULL DEFAULT 'FG',
          \`itemId\` VARCHAR(36) NOT NULL,
          \`npdId\` VARCHAR(36),
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
	          \`closeBy\` VARCHAR(255),
	          \`closeDate\` VARCHAR(50),
	          \`cancelTimestamp\` VARCHAR(255),
	          \`cancelEmailId\` VARCHAR(255),
	          \`cancelRemarks\` TEXT,
	          \`updatedBy\` VARCHAR(255),
	          \`updateTimestamp\` VARCHAR(255)
	        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`php_job_master\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`parentProductionId\` VARCHAR(36),
          \`scheduleId\` VARCHAR(36),
          \`itemId\` VARCHAR(255) NOT NULL,
          \`npdId\` VARCHAR(255),
          \`erpCode\` VARCHAR(255),
          \`companyName\` VARCHAR(255),
          \`jobCardNo\` VARCHAR(255),
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending Consumption',
          \`noOfParts\` DECIMAL(15,2),
          \`ups\` DECIMAL(15,2),
          \`length\` DECIMAL(15,2),
          \`breadth\` DECIMAL(15,2),
          \`height\` DECIMAL(15,2),
          \`ply\` DECIMAL(15,2),
          \`flute\` VARCHAR(255),
          \`gsm\` DECIMAL(15,2),
          \`plateWeight\` DECIMAL(15,5),
          \`rate\` DECIMAL(15,2),
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`tallyTimestamp\` VARCHAR(255),
          \`closeBy\` VARCHAR(255),
          \`closeDate\` VARCHAR(50),
          \`cancelTimestamp\` VARCHAR(255),
          \`cancelEmailId\` VARCHAR(255),
          \`cancelRemarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`plate_job_master\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`transactionNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`parentProductionId\` VARCHAR(36),
          \`scheduleId\` VARCHAR(36),
          \`itemId\` VARCHAR(255) NOT NULL,
          \`npdId\` VARCHAR(255),
          \`erpCode\` VARCHAR(255),
          \`companyName\` VARCHAR(255),
          \`jobCardNo\` VARCHAR(255),
          \`qty\` DECIMAL(15,2) NOT NULL,
          \`uom\` VARCHAR(50) NOT NULL,
          \`remarks\` TEXT,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending Consumption',
          \`noOfParts\` DECIMAL(15,2),
          \`ups\` DECIMAL(15,2),
          \`length\` DECIMAL(15,2),
          \`breadth\` DECIMAL(15,2),
          \`height\` DECIMAL(15,2),
          \`ply\` DECIMAL(15,2),
          \`flute\` VARCHAR(255),
          \`gsm\` DECIMAL(15,2),
          \`plateWeight\` DECIMAL(15,5),
          \`rate\` DECIMAL(15,2),
          \`phTimestamp\` VARCHAR(255),
          \`phEmailId\` VARCHAR(255),
          \`tallyTimestamp\` VARCHAR(255),
          \`closeBy\` VARCHAR(255),
          \`closeDate\` VARCHAR(50),
          \`cancelTimestamp\` VARCHAR(255),
          \`cancelEmailId\` VARCHAR(255),
          \`cancelRemarks\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`php_dispatch_plans\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`scheduleId\` VARCHAR(36),
          \`orderId\` VARCHAR(36),
          \`productionId\` VARCHAR(36),
          \`truckId\` VARCHAR(36) NOT NULL,
          \`plannedQty\` DECIMAL(15,2) NOT NULL,
          \`loadedQty\` DECIMAL(15,2) DEFAULT 0,
          \`canceledQty\` DECIMAL(15,2) DEFAULT 0,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Planned',
          \`date\` VARCHAR(50) NOT NULL,
          \`planNo\` VARCHAR(100),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`plate_dispatch_plans\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`scheduleId\` VARCHAR(36),
          \`orderId\` VARCHAR(36),
          \`productionId\` VARCHAR(36),
          \`truckId\` VARCHAR(36) NOT NULL,
          \`plannedQty\` DECIMAL(15,2) NOT NULL,
          \`loadedQty\` DECIMAL(15,2) DEFAULT 0,
          \`canceledQty\` DECIMAL(15,2) DEFAULT 0,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Planned',
          \`date\` VARCHAR(50) NOT NULL,
          \`planNo\` VARCHAR(100),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`php_loading_slips\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`slipNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`truckId\` VARCHAR(36),
          \`lines\` JSON NOT NULL,
          \`packingDetails\` JSON,
          \`extraItemsQty\` DECIMAL(15,2),
          \`invoiceId\` VARCHAR(36),
          \`status\` VARCHAR(20) DEFAULT 'Active',
          \`cancelReason\` TEXT,
          \`cancelledAt\` VARCHAR(255),
          \`cancelledBy\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`plate_loading_slips\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`slipNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`truckId\` VARCHAR(36),
          \`lines\` JSON NOT NULL,
          \`packingDetails\` JSON,
          \`extraItemsQty\` DECIMAL(15,2),
          \`invoiceId\` VARCHAR(36),
          \`status\` VARCHAR(20) DEFAULT 'Active',
          \`cancelReason\` TEXT,
          \`cancelledAt\` VARCHAR(255),
          \`cancelledBy\` VARCHAR(255),
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
          \`destination\` VARCHAR(255),
          \`transporter\` VARCHAR(255),
          \`gstRate\` DECIMAL(5,2) NOT NULL,
          \`totalBeforeGst\` DECIMAL(15,2) NOT NULL,
          \`cgst\` DECIMAL(15,2) NOT NULL,
          \`sgst\` DECIMAL(15,2) NOT NULL,
          \`igst\` DECIMAL(15,2) NOT NULL,
          \`totalAfterGst\` DECIMAL(15,2) NOT NULL,
          \`otherCharges\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`roundOff\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`tallyTimestamp\` VARCHAR(255),
          \`tallyBy\` VARCHAR(255),
          \`tallySyncRemark\` TEXT,
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`services\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL,
          \`active\` VARCHAR(10) DEFAULT 'Yes',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);
      try {
        const [existingServiceRows] = await db.query("SELECT COUNT(*) as count FROM `services`");
        const existingServiceCount = Number((existingServiceRows as any[])[0]?.count || 0);
        if (existingServiceCount === 0) {
          const timestamp = new Date().toISOString();
          await db.query(
            "INSERT INTO `services` (`id`,`name`,`active`,`updatedBy`,`updateTimestamp`) VALUES (UUID(),'Repairing','Yes','System User',?), (UUID(),'Other Charges','Yes','System User',?)",
            [timestamp, timestamp]
          );
        }
      } catch (seedError) {
        console.warn("[DB] Could not seed services table:", (seedError as Error).message);
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`gate_passes\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`gatePassNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`gatePassType\` VARCHAR(30) NOT NULL DEFAULT 'Non-Returnable',
          \`invoiceId\` VARCHAR(36),
          \`invoiceNo\` VARCHAR(100),
          \`companyId\` VARCHAR(36),
          \`companyName\` VARCHAR(255),
          \`recipientId\` VARCHAR(36),
          \`recipientName\` VARCHAR(255),
          \`recipientType\` VARCHAR(30),
          \`sentByUserId\` VARCHAR(36),
          \`sentByUserName\` VARCHAR(255),
          \`truckId\` VARCHAR(36),
          \`truckNo\` VARCHAR(255),
          \`loadingSlipIds\` JSON NOT NULL,
          \`loadingSlipNos\` JSON NOT NULL,
          \`remarks\` TEXT,
          \`clearOffReason\` TEXT,
          \`clearedOffAt\` VARCHAR(255),
          \`clearedOffBy\` VARCHAR(255),
          \`totalQty\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`totalAmount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
          \`lines\` JSON NOT NULL,
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
          \`npdId\` VARCHAR(36),
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
        CREATE TABLE IF NOT EXISTS \`npd\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`npdId\` LONGTEXT,
          \`timestamp\` LONGTEXT,
          \`date\` LONGTEXT,
          \`boxType\` LONGTEXT,
          \`companyId\` LONGTEXT,
          \`customerName\` LONGTEXT,
          \`contactPerson\` LONGTEXT,
          \`contactNumber\` LONGTEXT,
          \`email\` LONGTEXT,
          \`itemName\` LONGTEXT,
          \`erp\` LONGTEXT,
          \`rate\` LONGTEXT,
          \`uom\` LONGTEXT,
          \`fluteType\` LONGTEXT,
          \`ply\` LONGTEXT,
          \`noOfParts\` LONGTEXT,
          \`noOfUps\` LONGTEXT,
          \`idToOd2\` LONGTEXT,
          \`openLength\` LONGTEXT,
          \`openWidth\` LONGTEXT,
          \`lengthId\` LONGTEXT,
          \`breadthId\` LONGTEXT,
          \`heightId\` LONGTEXT,
          \`lengthOd\` LONGTEXT,
          \`breadthOd\` LONGTEXT,
          \`heightOd\` LONGTEXT,
          \`psL1\` LONGTEXT,
          \`psL1Bf\` LONGTEXT,
          \`psF1\` LONGTEXT,
          \`psF1Bf\` LONGTEXT,
          \`psL2\` LONGTEXT,
          \`psL2Bf\` LONGTEXT,
          \`psF2\` LONGTEXT,
          \`psF2Bf\` LONGTEXT,
          \`psL3\` LONGTEXT,
          \`psL3Bf\` LONGTEXT,
          \`materialWeightInsideInOneBox\` LONGTEXT,
          \`stackHeight\` LONGTEXT,
          \`safetyFactor\` LONGTEXT,
          \`csKgStd\` LONGTEXT,
          \`csKgTarget\` LONGTEXT,
          \`bsKgCm2Std\` LONGTEXT,
          \`bsKgCm2Calculated\` LONGTEXT,
          \`takeUpFactor\` LONGTEXT,
          \`ups\` LONGTEXT,
          \`rapc\` LONGTEXT,
          \`opening\` LONGTEXT,
          \`receipt\` LONGTEXT,
          \`production\` LONGTEXT,
          \`invoiced\` LONGTEXT,
          \`balance\` LONGTEXT,
          \`gstRate\` LONGTEXT,
          \`part\` LONGTEXT,
          \`cuttingWithTrimming\` LONGTEXT,
          \`standardWeightGms\` LONGTEXT,
          \`calculatedWeightPerBox\` LONGTEXT,
          \`standardBGsm\` LONGTEXT,
          \`calculatedBGsm\` LONGTEXT,
          \`stitchingGluing\` LONGTEXT,
          \`rsl1\` LONGTEXT,
          \`rsl1Bf\` LONGTEXT,
          \`rsf2\` LONGTEXT,
          \`rsf2Bf\` LONGTEXT,
          \`rsl3\` LONGTEXT,
          \`rsl3Bf\` LONGTEXT,
          \`rsf4\` LONGTEXT,
          \`rsf4Bf\` LONGTEXT,
          \`rsl5\` LONGTEXT,
          \`rsf5Bf\` LONGTEXT,
          \`flapSize\` LONGTEXT,
          \`deckleSize\` LONGTEXT,
          \`topPaperShade\` LONGTEXT,
          \`colorId1\` LONGTEXT,
          \`printingColour1\` LONGTEXT,
          \`colorId2\` LONGTEXT,
          \`printingColour2\` LONGTEXT,
          \`plainBox\` LONGTEXT,
          \`whetherPlateApplicable\` LONGTEXT,
          \`whetherPhpApplicable\` LONGTEXT,
          \`dimensionsApproved\` LONGTEXT,
          \`artworkApproved\` LONGTEXT,
          \`artworkUpload\` LONGTEXT,
          \`url\` LONGTEXT,
          \`poDate\` LONGTEXT,
          \`poNumber\` LONGTEXT,
          \`supplier\` LONGTEXT,
          \`printingBlockItemName\` LONGTEXT,
          \`blockSizeSqInch\` LONGTEXT,
          \`approvedRateOfSupplier\` LONGTEXT,
          \`poPdf\` LONGTEXT,
          \`chargeableToCustomer\` LONGTEXT,
          \`amount\` LONGTEXT,
          \`poPdfApproval\` LONGTEXT,
          \`emailSentToSupplier\` LONGTEXT,
          \`emailTimestamp\` LONGTEXT,
          \`invoiceNo\` LONGTEXT,
          \`invoiceDate\` LONGTEXT,
          \`invoiceAmount\` LONGTEXT,
          \`geNo\` LONGTEXT,
          \`mrrNo\` LONGTEXT,
          \`dateOfReceipt\` LONGTEXT,
          \`supplierInvoiceNoMrr\` LONGTEXT,
          \`itemValueMrr\` LONGTEXT,
          \`invoiceValueMrr\` LONGTEXT,
          \`approvalStatus\` LONGTEXT,
          \`debitNoteNo\` LONGTEXT,
          \`debitNoteDate\` LONGTEXT,
          \`debitNoteAmount\` LONGTEXT,
          \`customerPoNo\` LONGTEXT,
          \`customerPoDate\` LONGTEXT,
          \`orderQuantity\` LONGTEXT,
          \`orderRate\` LONGTEXT,
          \`customerPoAmount\` LONGTEXT,
          \`boxesPerSheetDieCut\` LONGTEXT,
          \`reelSize\` LONGTEXT,
          \`cuttingSize\` LONGTEXT,
          \`rapcForSingleBox\` LONGTEXT,
          \`dieCutUps\` LONGTEXT,
          \`syncInItemMaster\` LONGTEXT,
          \`platePhpWeight\` LONGTEXT,
          \`gsmLeastCost\` LONGTEXT,
          \`backingPaperShade\` LONGTEXT,
          \`artwork\` LONGTEXT,
          \`spec\` LONGTEXT,
          \`syncSource\` VARCHAR(50),
          \`syncStatus\` VARCHAR(20) DEFAULT 'active',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      // Migration: Add uom to npd table if missing
      try {
        const [columns] = await db.query(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'npd'",
          [database]
        );
        const existingColumns = (columns as any[]).map((c: any) => c.COLUMN_NAME);
        
        if (!existingColumns.includes("uom")) {
          console.log("[DB] Adding uom to npd...");
          await db.query("ALTER TABLE \`npd\` ADD COLUMN \`uom\` LONGTEXT");
        }
      } catch (err) {
        console.warn("[DB] Could not alter npd table:", (err as Error).message);
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`php_item_master\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`itemId\` LONGTEXT,
          \`timestamp\` LONGTEXT,
          \`npdId\` LONGTEXT,
          \`itemName\` LONGTEXT,
          \`company\` LONGTEXT,
          \`hostingerSync\` LONGTEXT,
          \`syncSource\` VARCHAR(50),
          \`syncStatus\` VARCHAR(20) DEFAULT 'active',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`plate_item_master\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`itemId\` LONGTEXT,
          \`timestamp\` LONGTEXT,
          \`npdId\` LONGTEXT,
          \`itemName\` LONGTEXT,
          \`company\` LONGTEXT,
          \`hostingerSync\` LONGTEXT,
          \`syncSource\` VARCHAR(50),
          \`syncStatus\` VARCHAR(20) DEFAULT 'active',
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await ensureNpdSchemaColumns(db, database);
      await ensureSheetMasterSchemaColumns(db, database, "php_item_master", PHP_ITEM_MASTER_SCHEMA_COLUMNS);
      await ensureSheetMasterSchemaColumns(db, database, "plate_item_master", PLATE_ITEM_MASTER_SCHEMA_COLUMNS);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`settings\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`reelAsPerCalculation\` TEXT,
          \`flapAsPerCalculation\` TEXT,
          \`cuttingSizeAsPerCalculation\` TEXT,
          \`gsmAsPerCalculation\` TEXT,
          \`productionFormVisibleColumns\` LONGTEXT,
          \`realizationPerKgTargets\` LONGTEXT,
          \`invoiceNumberSeries\` LONGTEXT,
          \`mandatoryMachinesByType\` LONGTEXT,
          \`designations\` LONGTEXT,
          \`organizationName\` VARCHAR(255),
          \`organizationAddress\` TEXT,
          \`organizationGstDetails\` TEXT,
          \`organizationLogo\` VARCHAR(255),
          \`updatedBy\` VARCHAR(255),
          \`updateTimestamp\` VARCHAR(255)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`uploaded_files\` (
          \`filename\` VARCHAR(255) PRIMARY KEY,
          \`mimeType\` VARCHAR(100),
          \`data\` LONGBLOB NOT NULL,
          \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS \`material_visit\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`visitNo\` VARCHAR(100) NOT NULL,
          \`date\` VARCHAR(50) NOT NULL,
          \`supplierId\` VARCHAR(36),
          \`visitorName\` VARCHAR(255) NOT NULL,
          \`purpose\` TEXT NOT NULL,
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'Pending',
          \`remarks\` TEXT,
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
        { table: "materials", column: "color", type: "VARCHAR(255)" },
        { table: "materials", column: "size", type: "DECIMAL(15,2)" },
        { table: "materials", column: "gsm", type: "DECIMAL(15,2)" },
        { table: "materials", column: "bf", type: "DECIMAL(15,2)" },
        { table: "materials", column: "openingQty", type: "DECIMAL(15,2)" },
        { table: "materials", column: "openingRate", type: "DECIMAL(15,2)" },
        { table: "materials", column: "openingValue", type: "DECIMAL(15,2)" },
        { table: "materials", column: "remarks", type: "TEXT" },
        { table: "materials", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "materials", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "materials", column: "tallyMaterialId", type: "VARCHAR(255)" },
        { table: "materials", column: "tallySyncRemark", type: "TEXT" },
        { table: "indents", column: "indentNo", type: "VARCHAR(30)" },
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
        { table: "indent_lines", column: "targetDeliveryDate", type: "VARCHAR(50)" },
        { table: "indent_lines", column: "orderedQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "cancelledQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "balanceQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "indent_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "indent_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "purchase_orders", column: "poNo", type: "VARCHAR(100) NOT NULL" },
        { table: "purchase_orders", column: "indentId", type: "VARCHAR(36)" },
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
        { table: "purchase_order_lines", column: "targetDeliveryDate", type: "VARCHAR(50)" },
        { table: "purchase_order_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "purchase_order_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "gate_entries", column: "gateEntryNo", type: "VARCHAR(100)" },
        { table: "gate_entries", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "gate_entries", column: "supplierId", type: "VARCHAR(36) NOT NULL" },
        { table: "gate_entries", column: "purpose", type: "VARCHAR(50)" },
        { table: "gate_entries", column: "invoiceNo", type: "VARCHAR(100) NOT NULL" },
        { table: "gate_entries", column: "invoiceValue", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "gate_entries", column: "truckNo", type: "VARCHAR(100) NOT NULL" },
        { table: "gate_entries", column: "sourceGatePassId", type: "VARCHAR(36)" },
        { table: "gate_entries", column: "sourceGatePassNo", type: "VARCHAR(100)" },
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
        { table: "material_in_packing_slips", column: "materialInId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_in_packing_slips", column: "materialLineId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_in_packing_slips", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_in_packing_slips", column: "supplierReelNo", type: "VARCHAR(255)" },
        { table: "material_in_packing_slips", column: "ourReelNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_in_packing_slips", column: "weightKg", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "material_in_packing_slips", column: "supplierPoNo", type: "VARCHAR(255)" },
        { table: "material_in_packing_slips", column: "ourPoId", type: "VARCHAR(36)" },
        { table: "material_in_packing_slips", column: "ourPoNo", type: "VARCHAR(100)" },
        { table: "material_in_packing_slips", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_in_packing_slips", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_issues", column: "issueNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_issues", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "material_issues", column: "issueType", type: "VARCHAR(50) NOT NULL" },
        { table: "material_issues", column: "productionId", type: "VARCHAR(36)" },
        { table: "material_issues", column: "jobNo", type: "VARCHAR(100)" },
        { table: "material_issues", column: "remarks", type: "TEXT" },
        { table: "material_issues", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_issues", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_issue_lines", column: "materialIssueId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_lines", column: "qty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "material_issue_lines", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "material_issue_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_issue_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_issue_reel_lines", column: "materialIssueId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_reel_lines", column: "materialIssueLineId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_reel_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_reel_lines", column: "packingSlipId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_reel_lines", column: "ourReelNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_issue_reel_lines", column: "weightKg", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "material_issue_reel_lines", column: "productionId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_issue_reel_lines", column: "jobNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_issue_reel_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_issue_reel_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_returns", column: "returnNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_returns", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "material_returns", column: "returnType", type: "VARCHAR(50) NOT NULL" },
        { table: "material_returns", column: "productionId", type: "VARCHAR(36)" },
        { table: "material_returns", column: "jobNo", type: "VARCHAR(100)" },
        { table: "material_returns", column: "remarks", type: "TEXT" },
        { table: "material_returns", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_returns", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_return_lines", column: "materialReturnId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_lines", column: "qty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "material_return_lines", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "material_return_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_return_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_return_reel_lines", column: "materialReturnId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_reel_lines", column: "materialReturnLineId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_reel_lines", column: "materialId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_reel_lines", column: "packingSlipId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_reel_lines", column: "ourReelNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_return_reel_lines", column: "weightKg", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "material_return_reel_lines", column: "productionId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_return_reel_lines", column: "jobNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_return_reel_lines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_return_reel_lines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "suppliers", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "suppliers", column: "contactPerson", type: "VARCHAR(255)" },
        { table: "suppliers", column: "contactNumber", type: "VARCHAR(50)" },
        { table: "suppliers", column: "email", type: "VARCHAR(255)" },
        { table: "suppliers", column: "gstNo", type: "VARCHAR(100)" },
        { table: "suppliers", column: "gstSupplyType", type: "VARCHAR(20) DEFAULT 'INTRA_STATE'" },
        { table: "suppliers", column: "stateId", type: "VARCHAR(36)" },
        { table: "suppliers", column: "district", type: "VARCHAR(255)" },
        { table: "suppliers", column: "pinCode", type: "VARCHAR(20)" },
        { table: "suppliers", column: "address", type: "TEXT" },
        { table: "suppliers", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "states", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "states", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "color_masters", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "gst_rate_masters", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "gst_rate_masters", column: "rate", type: "DECIMAL(5,2) NOT NULL DEFAULT 0" },
        { table: "gst_rate_masters", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "gst_rate_masters", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "gst_rate_masters", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "services", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "services", column: "active", type: "VARCHAR(10) DEFAULT 'Yes'" },
        { table: "services", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "services", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "material_in", column: "mrrType", type: "VARCHAR(50)" },
        { table: "material_in", column: "gateEntryId", type: "VARCHAR(36)" },
        { table: "material_in", column: "gateEntryNo", type: "VARCHAR(100)" },
        { table: "material_in", column: "sourceGatePassId", type: "VARCHAR(36)" },
        { table: "material_in", column: "sourceGatePassNo", type: "VARCHAR(100)" },
        { table: "material_in", column: "timestamp", type: "VARCHAR(255) NOT NULL" },
        { table: "material_in", column: "entryEmailId", type: "VARCHAR(255) NOT NULL" },
        { table: "material_in", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "material_in", column: "invoiceNo", type: "VARCHAR(100)" },
        { table: "material_in", column: "invDate", type: "VARCHAR(50)" },
        { table: "material_in", column: "lines", type: "JSON NOT NULL" },
        { table: "material_in", column: "supplierId", type: "VARCHAR(36) NOT NULL" },
        { table: "material_in", column: "totalPoValue", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalInvoiceValue", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalActualValue", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalCgst", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalSgst", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalIgst", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalInvoiceValueAfterGst", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "insurance", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "otherCharges", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "roundOff", type: "DECIMAL(15, 2) NOT NULL DEFAULT 0" },
        { table: "material_in", column: "totalAmount", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "material_in", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "mdTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "mdEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "tallySyncRemark", type: "TEXT" },
        { table: "material_in", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "productions", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "productions", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "productions", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "productions", column: "npdId", type: "VARCHAR(36)" },
        { table: "productions", column: "qty", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "productions", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "productions", column: "remarks", type: "TEXT" },
        { table: "productions", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
	        { table: "productions", column: "tallyTimestamp", type: "VARCHAR(255)" },
	        { table: "productions", column: "closeBy", type: "VARCHAR(255)" },
	        { table: "productions", column: "closeDate", type: "VARCHAR(50)" },
	        { table: "productions", column: "cancelTimestamp", type: "VARCHAR(255)" },
	        { table: "productions", column: "cancelEmailId", type: "VARCHAR(255)" },
	        { table: "productions", column: "cancelRemarks", type: "TEXT" },
        { table: "consumptions", column: "transactionNo", type: "VARCHAR(100) NOT NULL" },
        { table: "consumptions", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "consumptions", column: "npdId", type: "VARCHAR(36)" },
        { table: "consumptions", column: "qty", type: "DECIMAL(15, 2) NOT NULL" },
        { table: "consumptions", column: "uom", type: "VARCHAR(50) NOT NULL" },
        { table: "consumptions", column: "remarks", type: "TEXT" },
        { table: "consumptions", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "consumptions", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "sample_requests", column: "timestamp", type: "VARCHAR(255) NOT NULL" },
        { table: "sample_requests", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "sample_requests", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "sample_requests", column: "npdId", type: "VARCHAR(36)" },
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
        { table: "users", column: "designation", type: "VARCHAR(255)" },
        { table: "companies", column: "deviationAllowed", type: "DECIMAL(10,2)" },
        { table: "companies", column: "toleranceAllowed", type: "DECIMAL(10,2)" },
        { table: "companies", column: "gstSupplyType", type: "VARCHAR(20) DEFAULT 'INTRA_STATE'" },
        { table: "material_in", column: "accTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "accEmailId", type: "VARCHAR(255)" },
        { table: "orders", column: "approvedTimestamp", type: "VARCHAR(255)" },
        { table: "orders", column: "approvedEmail", type: "VARCHAR(255)" },
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
        { table: "companies", column: "syncSource", type: "VARCHAR(50)" },
        { table: "companies", column: "syncStatus", type: "VARCHAR(20) DEFAULT 'active'" },
        { table: "machines", column: "name", type: "VARCHAR(255) NOT NULL" },
        { table: "machines", column: "maxOutputPerHour", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "machines", column: "assignedOperatorIds", type: "JSON" },
        { table: "machines", column: "assignedOperatorNames", type: "JSON" },
        { table: "machines", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "machines", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "production_processing", column: "productionId", type: "VARCHAR(36) NOT NULL" },
        { table: "production_processing", column: "jobNo", type: "VARCHAR(100)" },
        { table: "production_processing", column: "machineId", type: "VARCHAR(36) NOT NULL" },
        { table: "production_processing", column: "machineName", type: "VARCHAR(255)" },
        { table: "production_processing", column: "shift", type: "VARCHAR(10) DEFAULT 'Day'" },
        { table: "production_processing", column: "qty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "production_processing", column: "operatorId", type: "VARCHAR(36) NOT NULL" },
        { table: "production_processing", column: "operatorName", type: "VARCHAR(255)" },
        { table: "production_processing", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "production_processing", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "production_processing", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "material_in", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "users", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "users", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "orders", column: "orderDate", type: "VARCHAR(50) NOT NULL" },
        { table: "orders", column: "companyId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders", column: "itemSource", type: "VARCHAR(20) NOT NULL DEFAULT 'FG'" },
        { table: "orders", column: "npdId", type: "VARCHAR(36)" },
        { table: "orders", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "orders", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Pending PH'" },
        { table: "orders", column: "erpCode", type: "VARCHAR(100)" },
        { table: "orders", column: "poNumber", type: "VARCHAR(100)" },
        { table: "orders", column: "rate", type: "DECIMAL(15,2)" },
        { table: "orders", column: "orderAmount", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "orders", column: "poType", type: "VARCHAR(50)" },
        { table: "orders_schedule", column: "orderId", type: "VARCHAR(36) NOT NULL" },
        { table: "orders_schedule", column: "scheduledDate", type: "VARCHAR(50) NOT NULL" },
        { table: "orders_schedule", column: "qty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "orders_schedule", column: "producedQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "orders_schedule", column: "canceledQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "productions", column: "scheduleId", type: "VARCHAR(36)" },
        { table: "productions", column: "parentProductionId", type: "VARCHAR(36)" },
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
        { table: "dispatch_plans", column: "productionId", type: "VARCHAR(36)" },
        { table: "dispatch_plans", column: "truckId", type: "VARCHAR(36) NOT NULL" },
        { table: "dispatch_plans", column: "plannedQty", type: "DECIMAL(15,2) NOT NULL" },
        { table: "dispatch_plans", column: "status", type: "VARCHAR(50) NOT NULL DEFAULT 'Planned'" },
        { table: "dispatch_plans", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "dispatch_plans", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "dispatch_plans", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "dispatch_plans", column: "planNo", type: "VARCHAR(100)" },
        { table: "dispatch_plans", column: "loadedQty", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "dispatch_plans", column: "canceledQty", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "loading_slips", column: "slipNo", type: "VARCHAR(100) NOT NULL" },
        { table: "loading_slips", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "loading_slips", column: "truckId", type: "VARCHAR(36)" },
        { table: "loading_slips", column: "lines", type: "JSON NOT NULL" },
        { table: "loading_slips", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "loading_slips", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "loading_slips", column: "invoiceId", type: "VARCHAR(36)" },
        { table: "loading_slips", column: "packingDetails", type: "JSON" },
        { table: "loading_slips", column: "extraItemsQty", type: "DECIMAL(15,2)" },
        { table: "invoices", column: "invoiceNo", type: "VARCHAR(100) NOT NULL" },
        { table: "invoices", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "invoices", column: "companyId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoices", column: "destination", type: "VARCHAR(255)" },
        { table: "invoices", column: "transporter", type: "VARCHAR(255)" },
        { table: "invoices", column: "gstRate", type: "DECIMAL(5,2) NOT NULL" },
        { table: "invoices", column: "totalBeforeGst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "cgst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "sgst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "igst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "totalAfterGst", type: "DECIMAL(15,2) NOT NULL" },
        { table: "invoices", column: "otherCharges", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "invoices", column: "roundOff", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "invoices", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "invoices", column: "tallyBy", type: "VARCHAR(255)" },
        { table: "invoices", column: "tallySyncRemark", type: "TEXT" },
        { table: "invoices", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "invoices", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "gatePassNo", type: "VARCHAR(100) NOT NULL" },
        { table: "gate_passes", column: "date", type: "VARCHAR(50) NOT NULL" },
        { table: "gate_passes", column: "gatePassType", type: "VARCHAR(30) NOT NULL DEFAULT 'Non-Returnable'" },
        { table: "gate_passes", column: "invoiceId", type: "VARCHAR(36)" },
        { table: "gate_passes", column: "invoiceNo", type: "VARCHAR(100)" },
        { table: "gate_passes", column: "companyId", type: "VARCHAR(36)" },
        { table: "gate_passes", column: "companyName", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "recipientId", type: "VARCHAR(36)" },
        { table: "gate_passes", column: "recipientName", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "recipientType", type: "VARCHAR(30)" },
        { table: "gate_passes", column: "sentByUserId", type: "VARCHAR(36)" },
        { table: "gate_passes", column: "sentByUserName", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "truckId", type: "VARCHAR(36)" },
        { table: "gate_passes", column: "truckNo", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "loadingSlipIds", type: "JSON NOT NULL" },
        { table: "gate_passes", column: "loadingSlipNos", type: "JSON NOT NULL" },
        { table: "gate_passes", column: "remarks", type: "TEXT" },
        { table: "gate_passes", column: "clearOffReason", type: "TEXT" },
        { table: "gate_passes", column: "clearedOffAt", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "clearedOffBy", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "totalQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "gate_passes", column: "totalAmount", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
        { table: "gate_passes", column: "lines", type: "JSON NOT NULL" },
        { table: "gate_passes", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "gate_passes", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "invoice_line_items", column: "invoiceId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "loadingSlipId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "itemId", type: "VARCHAR(36) NOT NULL" },
        { table: "invoice_line_items", column: "npdId", type: "VARCHAR(36)" },
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
        { table: "loading_slips", column: "status", type: "VARCHAR(20) DEFAULT 'Active'" },
        { table: "loading_slips", column: "cancelReason", type: "TEXT" },
        { table: "loading_slips", column: "cancelledAt", type: "VARCHAR(255)" },
        { table: "loading_slips", column: "cancelledBy", type: "VARCHAR(255)" },
        { table: "settings", column: "reelAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "flapAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "cuttingSizeAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "gsmAsPerCalculation", type: "TEXT" },
        { table: "settings", column: "productionFormVisibleColumns", type: "LONGTEXT" },
        { table: "settings", column: "realizationPerKgTargets", type: "LONGTEXT" },
        { table: "settings", column: "invoiceNumberSeries", type: "LONGTEXT" },
        { table: "settings", column: "mandatoryMachinesByType", type: "LONGTEXT" },
        { table: "settings", column: "designations", type: "LONGTEXT" },
        { table: "settings", column: "organizationName", type: "VARCHAR(255)" },
        { table: "settings", column: "organizationAddress", type: "TEXT" },
        { table: "settings", column: "organizationGstDetails", type: "TEXT" },
        { table: "settings", column: "organizationLogo", type: "VARCHAR(255)" },
        { table: "settings", column: "updatedBy", type: "VARCHAR(255)" },
        { table: "settings", column: "updateTimestamp", type: "VARCHAR(255)" },
        { table: "users", column: "role", type: "VARCHAR(20) NOT NULL DEFAULT 'Employee'" },
        { table: "users", column: "status", type: "VARCHAR(20) NOT NULL DEFAULT 'Active'" },
        { table: "users", column: "menuAccess", type: "JSON" },
        { table: "material_in", column: "phTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "phEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "plant_head_remark", type: "TEXT" },
        { table: "material_in", column: "accTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "accEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "accounts_remark", type: "TEXT" },
        { table: "material_in", column: "debitNote", type: "VARCHAR(255)" },
        { table: "material_in", column: "debitNoteDate", type: "VARCHAR(50)" },
        { table: "material_in", column: "debitNoteAmount", type: "DECIMAL(15,2)" },
        { table: "material_in", column: "mdTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "mdEmailId", type: "VARCHAR(255)" },
        { table: "material_in", column: "md_approval_remark", type: "TEXT" },
        { table: "material_in", column: "tallyTimestamp", type: "VARCHAR(255)" },
        { table: "material_in", column: "insurance", type: "DECIMAL(15,2) DEFAULT 0" },
        { table: "material_in", column: "otherCharges", type: "DECIMAL(15,2) DEFAULT 0" },
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
        await db.query("ALTER TABLE `material_in` MODIFY COLUMN `status` VARCHAR(50) NOT NULL DEFAULT 'Pending PH'");
      } catch (err) {
        console.warn("[DB] Could not normalize material_in.status column:", (err as Error).message);
      }

      try {
        await db.query(`
          UPDATE \`orders\`
          SET \`orderAmount\` = ROUND(COALESCE(\`qty\`, 0) * COALESCE(\`rate\`, 0), 2)
        `);
      } catch (err) {
        console.warn("[DB] Could not backfill orders.orderAmount:", (err as Error).message);
      }

      try {
        await ensureUsersCanonicalData(db, database);
      } catch (err) {
        console.warn("[DB] Could not normalize legacy users columns:", (err as Error).message);
      }

      try {
        await ensureGatePassNullableColumns(db, database);
      } catch (err) {
        console.warn("[DB] Could not normalize gate_passes nullable invoice fields:", (err as Error).message);
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
        const [rows] = await db.query(
          "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_NAME = 'invoice_line_items' AND CONSTRAINT_NAME = 'fk_invoice_line_items_itemId_items' AND REFERENCED_TABLE_NAME = 'items'"
        );
        if (Array.isArray(rows) && rows.length > 0) {
          console.log("[DB] Dropping legacy foreign key fk_invoice_line_items_itemId_items...");
          await db.query("ALTER TABLE `invoice_line_items` DROP FOREIGN KEY `fk_invoice_line_items_itemId_items` ");
        }
      } catch (err) {
        console.warn("[DB] Could not drop legacy foreign key:", (err as Error).message);
      }

      try {
        await ensureNpdSchemaColumns(db, database);
      } catch (err) {
        console.warn("[DB] Could not ensure npd schema columns:", (err as Error).message);
      }

      try {
        await ensureCompaniesSchemaColumns(db, database);
      } catch (err) {
        console.warn("[DB] Could not ensure companies schema columns:", (err as Error).message);
      }

      try {
        await ensureIndianStatesSeed(db);
      } catch (err) {
        console.warn("[DB] Could not seed official India states:", (err as Error).message);
      }

      try {
        await ensureBestEffortForeignKeys(db, database);
      } catch (err) {
        console.warn("[DB] Could not ensure foreign keys:", (err as Error).message);
      }

      try {
        await migrateItemMasterLinksToNpd(db, database);
      } catch (err) {
        console.warn("[DB] Could not migrate Item Master links to NPD:", (err as Error).message);
      }

      try {
        if (process.env.NODE_ENV !== "production") {
          await ensureDevSeedUser(db);
        }
      } catch (err) {
        console.warn("[DB] Could not ensure dev seed user:", (err as Error).message);
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

        if (tableName === "users") {
          [rows] = await db.query("SELECT * FROM `users`");
          const viewer = await getRequestUser(req);
          const isAdminViewer = viewer?.role === "Admin";
          const sanitized = (rows as any[])
            .map((row) => normalizeFetchedRow("users", row))
            .sort((a, b) => {
              const timeA = a?.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
              const timeB = b?.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
              return timeB - timeA || String(b?.id || "").localeCompare(String(a?.id || ""));
            })
            .map((r) => {
            const { password, menuAccess, ...rest } = r || {};
            return isAdminViewer ? { ...rest, menuAccess: normalizeMenuAccess(menuAccess) } : { ...rest };
          });
          return res.json(sanitized);
        }

        if (tableName === "items") {
          rows = await fetchActiveNpdItems(db);
        } else if (tableName === "invoice_line_items") {
          [rows] = await db.query(`
            SELECT
              ili.*,
              COALESCE(
                NULLIF(TRIM(ili.itemName), ''),
                NULLIF(TRIM(i.name), ''),
                NULLIF(TRIM(n.itemName), ''),
                NULLIF(TRIM(n.name), ''),
                'UNKNOWN'
              ) AS resolvedItemName
            FROM \`invoice_line_items\` ili
            LEFT JOIN \`items\` i
              ON i.id = ili.itemId
            LEFT JOIN \`npd\` n
              ON n.id = COALESCE(NULLIF(ili.npdId, ''), NULLIF(ili.itemId, ''))
          `);
        } else if (tableName === "npd") {
          const page = Math.max(1, Number(req.query.page || 1));
          const pageSize = Math.min(10000, Math.max(25, Number(req.query.pageSize || 10000)));
          const search = String(req.query.search || "").trim();
          const statusParam = String(req.query.status || "active").trim().toLowerCase();
          const status = statusParam === "removed" || statusParam === "all" ? statusParam : "active";
          const result = await fetchActiveNpdItems(db, {
            search,
            status,
            limit: pageSize,
            offset: (page - 1) * pageSize,
            includeTotal: true,
          }) as { rows: any[]; total: number };
          const processedRows = result.rows.map((row) => normalizeFetchedRow(tableName, row));
          return res.json({
            rows: processedRows,
            total: result.total,
            page,
            pageSize,
            search,
            status,
          });
        } else if (tableName === "production_processing") {
          [rows] = await db.query(`
            SELECT pp.*, n.itemName, n.erp, n.boxType
            FROM \`production_processing\` pp
            LEFT JOIN \`productions\` p ON pp.productionId = p.id
            LEFT JOIN \`npd\` n ON p.itemId = n.id
          `);
        } else {
          [rows] = await db.query(`SELECT * FROM \`${tableName}\``);
        }
        
        // Post-process rows to parse JSON columns
        const processedRows = (rows as any[]).map((row) => {
          const normalizedRow = normalizeFetchedRow(tableName, row);

          if (tableName === "invoice_line_items") {
            const resolvedItemName = String(
              row?.resolvedItemName ||
                normalizedRow?.itemName ||
                normalizedRow?.name ||
                "UNKNOWN"
            ).trim();
            return {
              ...normalizedRow,
              itemName: resolvedItemName || "UNKNOWN",
              name: resolvedItemName || "UNKNOWN",
            };
          }

          return normalizedRow;
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
      const data = normalizeNpdLinkedPayload(tableName, normalizeWorkflowStatus(tableName, req.body));
      try {
        if (tableName === "items") {
          delete data.receipt;
          delete data.production;
          delete data.invoiced;
          delete data.balance;
        }

        if (tableName === "orders") {
          data.itemSource = normalizeOrderItemSourceValue(data.itemSource);
          if (data.itemSource !== "FG") {
            delete data.npdId;
          }
          const rateNumber = Number(data.rate);
          if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
            return res.status(400).json({ error: "Rate must be greater than 0." });
          }
        }

        if (tableName === "materials") {
          const normalizedType = String(data.type || "").trim();
          if (normalizedType === "Reel") {
            const normalizedColor = String(data.color || "").trim();
            if (!normalizedColor) {
              return res.status(400).json({ error: "Color is required for Reel materials." });
            }
            data.color = normalizedColor;
          } else {
            data.color = null;
          }
        }

        if (tableName === "users") {
          const normalizedUserId = String(data.userId || "").trim();
          if (!normalizedUserId) {
            return res.status(400).json({ error: "User ID is required." });
          }

          const [databaseRows] = await db.query("SELECT DATABASE() as db");
          const currentDatabase = String((databaseRows as any[])[0]?.db || "");
          const userColumns = await getExistingColumnNames(db, currentDatabase, "users");
          const userIdSources = ["userId", "userid", "user_id"].filter((column) => userColumns.has(column));
          if (userIdSources.length === 0) {
            return res.status(500).json({ error: "Users table is missing a user ID column." });
          }
          const canonicalUserIdSql = `COALESCE(${userIdSources.map((column) => `NULLIF(TRIM(\`${column}\`), '')`).join(", ")})`;

          const [duplicateRows] = await db.query(
            `SELECT id, name,
                ${canonicalUserIdSql} as canonicalUserId
             FROM \`users\`
             WHERE LOWER(TRIM(${canonicalUserIdSql})) = LOWER(TRIM(?))
               AND id <> ?
             LIMIT 1`,
            [normalizedUserId, String(data.id || "")]
          );
          const duplicateUser = (duplicateRows as any[])[0];
          if (duplicateUser?.id) {
            return res.status(409).json({
              error: `User ID already exists for ${String(duplicateUser.name || duplicateUser.canonicalUserId || "another user")}.`,
            });
          }

          data.userId = normalizedUserId;
          data.updatedBy = String(data.updatedBy || "").trim() || "System Admin";
          data.updateTimestamp = String(data.updateTimestamp || "").trim() || new Date().toISOString();

          const userRecord: Record<string, any> = {
            id: String(data.id || crypto.randomUUID()),
            userId: data.userId,
            name: String(data.name || "").trim(),
            mobile: String(data.mobile || "").trim(),
            email: data.email ? String(data.email).trim() : null,
            password: data.password ? String(data.password) : null,
            designation: data.designation ? String(data.designation).trim() : null,
            role: normalizeUserRole(data.role),
            status: String(data.status || "Active") === "Inactive" ? "Inactive" : "Active",
            menuAccess: JSON.stringify(normalizeMenuAccess(data.menuAccess)),
            updatedBy: data.updatedBy,
            updateTimestamp: data.updateTimestamp,
          };

          const columnValueMap: Record<string, any> = {};
          const assignIfPresent = (column: string, value: any) => {
            if (userColumns.has(column)) columnValueMap[column] = value;
          };

          assignIfPresent("id", userRecord.id);
          assignIfPresent("userId", userRecord.userId);
          assignIfPresent("userid", userRecord.userId);
          assignIfPresent("user_id", userRecord.userId);
          assignIfPresent("name", userRecord.name);
          assignIfPresent("mobile", userRecord.mobile);
          assignIfPresent("email", userRecord.email);
          assignIfPresent("password", userRecord.password);
          assignIfPresent("designation", userRecord.designation);
          assignIfPresent("role", userRecord.role);
          assignIfPresent("status", userRecord.status);
          assignIfPresent("menuAccess", userRecord.menuAccess);
          assignIfPresent("menuaccess", userRecord.menuAccess);
          assignIfPresent("updatedBy", userRecord.updatedBy);
          assignIfPresent("updated_by", userRecord.updatedBy);
          assignIfPresent("updateTimestamp", userRecord.updateTimestamp);
          assignIfPresent("update_timestamp", userRecord.updateTimestamp);

          if (userColumns.has("id")) {
            const [existingRows] = await db.query("SELECT id FROM `users` WHERE id = ? LIMIT 1", [userRecord.id]);
            const exists = (existingRows as any[]).length > 0;
            const keys = Object.keys(columnValueMap);
            const values = keys.map((key) => columnValueMap[key]);

            if (exists) {
              const updates = keys.filter((key) => key !== "id").map((key) => `\`${key}\` = ?`).join(", ");
              await db.query(`UPDATE \`users\` SET ${updates} WHERE \`id\` = ?`, [...keys.filter((key) => key !== "id").map((key) => columnValueMap[key]), userRecord.id]);
            } else {
              const placeholders = keys.map(() => "?").join(", ");
              const columnNames = keys.map((key) => `\`${key}\``).join(", ");
              await db.query(`INSERT INTO \`users\` (${columnNames}) VALUES (${placeholders})`, values);
            }
          }

          return res.json(normalizeFetchedRow("users", userRecord));
        }

        if (tableName === "npd") {
          const normalizedErp = stringOrEmpty(data.erp);
          if (normalizedErp) {
            data.erp = normalizedErp;
            const currentId = String(data.id || "").trim();
            const [existingNpdRows] = await db.query(
              "SELECT id FROM `npd` WHERE COALESCE(NULLIF(TRIM(`erp`), ''), '') = ? AND id <> ? LIMIT 1",
              [normalizedErp, currentId]
            );
            const existingNpd = (existingNpdRows as any[])[0];
            if (existingNpd?.id) {
              data.id = String(existingNpd.id);
            }
          }
        }

        if (tableName === "production_processing") {
          const missing: string[] = [];
          if (!String(data.productionId || "").trim()) missing.push("Job/Production");
          if (!String(data.machineId || "").trim()) missing.push("Machine");
          if (!String(data.operatorId || "").trim()) missing.push("Operator");
          if (!String(data.shift || "").trim()) missing.push("Shift");
          if (!String(data.date || "").trim()) missing.push("Date");

          const qtyNumber = Number(data.qty);
          if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) missing.push("Quantity");

          if (missing.length) {
            return res.status(400).json({ error: `Mandatory fields missing/invalid: ${missing.join(", ")}` });
          }

          data.machineName = normalizeMachineName(String(data.machineName || ""));
        }

        // Auto-generate orderNo for orders when not provided
        if (tableName === 'orders') {
          try {
            const orderQty = Number(data.qty || 0);
            const orderRate = Number(data.rate || 0);
            data.orderAmount =
              Number.isFinite(orderQty) && Number.isFinite(orderRate)
                ? Number((orderQty * orderRate).toFixed(2))
                : 0;

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

            // Auto-approve order (skip Pending Salesman Approval) when:
            // 1) Order Rate == Last Billing Rate 1 (latest invoice rate for same item)
            // 2) Punch Date (orderDate) falls into a Realization Rate Chart range
            // 3) Last RAPC 1 (latest productions.realizationPerKg for same item) >= Realization Rate (from chart)
            // If auto-approved: fill approvedTimestamp + approvedEmail
            const currentStatus = String(data.status || "Pending PH").trim();
            const alreadyApproved = hasWorkflowValue(data.approvedTimestamp) || hasWorkflowValue(data.approvedEmail);
            if (!alreadyApproved && (currentStatus === "Pending PH" || !currentStatus)) {
              const itemSource = normalizeOrderItemSourceValue(data.itemSource);
              const itemId = itemSource === "FG" ? resolveLinkedNpdId(data) : "";
              const punchDate = String(data.orderDate || "").trim() || new Date().toISOString().slice(0, 10);

              if (itemId && Number.isFinite(orderRate) && punchDate) {
                const [billingRows] = await db.query(
                   `SELECT ili.rate
                     FROM \`invoice_line_items\` ili
                     JOIN \`invoices\` inv ON inv.id = ili.invoiceId
                     WHERE COALESCE(NULLIF(ili.npdId, ''), ili.itemId) = ?
                     ORDER BY inv.date DESC, inv.id DESC
                     LIMIT 1`,
                  [itemId]
                );
                const lastBillingRate1 = Number((billingRows as any[])?.[0]?.rate);

                const ratesMatch =
                  Number.isFinite(lastBillingRate1) && Math.abs(orderRate - lastBillingRate1) < 0.0001;

                if (ratesMatch) {
                  const [chartRows] = await db.query(
                    `SELECT realizationRate
                     FROM \`realization_rate_chart\`
                     WHERE STR_TO_DATE(?, '%Y-%m-%d') BETWEEN STR_TO_DATE(dateFrom, '%Y-%m-%d') AND STR_TO_DATE(dateTo, '%Y-%m-%d')
                     ORDER BY STR_TO_DATE(dateFrom, '%Y-%m-%d') DESC
                     LIMIT 1`,
                    [punchDate]
                  );
                  const realizationRate = Number((chartRows as any[])?.[0]?.realizationRate);

                  if (Number.isFinite(realizationRate)) {
                    const [rapcRows] = await db.query(
                      `SELECT realizationPerKg
                       FROM \`productions\`
                       WHERE COALESCE(NULLIF(npdId, ''), itemId) = ? AND realizationPerKg IS NOT NULL
                       ORDER BY date DESC
                       LIMIT 1`,
                      [itemId]
                    );
                    const lastRapc1 = Number((rapcRows as any[])?.[0]?.realizationPerKg);

                    if (Number.isFinite(lastRapc1) && lastRapc1 >= realizationRate) {
                      data.status = "Pending Scheduling";
                      data.approvedTimestamp = new Date().toISOString();
                      data.approvedEmail = String(data.updatedBy || data.orderBy || "System").trim() || "System";
                    } else {
                      data.status = data.status || "Pending PH";
                    }
                  } else {
                    data.status = data.status || "Pending PH";
                  }
                } else {
                  data.status = data.status || "Pending PH";
                }
              }
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate orderNo:', (err as Error).message);
          }
        }

        // Auto-generate indentNo for indents when not provided (FY-based: YY-YY/NNNNN)
        if (tableName === "indents") {
          try {
            if (!data.indentNo) {
              const dateStr = data.requisitionDate || new Date().toISOString().slice(0, 10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `${fyLabel}/%`;
              const [rows] = await db.query(
                "SELECT indentNo FROM `indents` WHERE indentNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(indentNo,'/',-1) AS UNSIGNED) DESC LIMIT 1",
                [likePattern]
              );
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastIndentNo = String((rows as any[])[0].indentNo || "");
                const parts = lastIndentNo.split("/");
                const suffix = parts[parts.length - 1];
                lastNum = parseInt(suffix || "0", 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, "0");
              data.indentNo = `${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn("[DB] Could not auto-generate indentNo:", (err as Error).message);
          }
        }

        // Auto-generate slipNo for loading tables when not provided
        if (['loading_slips', 'php_loading_slips', 'plate_loading_slips'].includes(tableName)) {
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
              data.invoiceNo = await generateDynamicInvoiceNo(db, data.date || new Date().toISOString().slice(0, 10));
            }
          } catch (err) {
            const message = (err as Error).message || "Could not auto-generate invoiceNo.";
            console.warn('[DB] Could not auto-generate invoiceNo:', message);
            return res.status(400).json({ error: message });
          }
        }

        // Auto-generate gatePassNo for gate_passes when not provided
        if (tableName === 'gate_passes') {
          try {
            if (!data.gatePassNo) {
              const dateStr = data.date || new Date().toISOString().slice(0,10);
              const d = new Date(dateStr);
              let fyStart = d.getFullYear();
              const month = d.getMonth() + 1;
              if (month < 4) fyStart = fyStart - 1;
              const fyLabel = `${fyStart}-${String(fyStart + 1).slice(2)}`;

              const likePattern = `GP/${fyLabel}/%`;
              const [rows] = await db.query(`SELECT gatePassNo FROM \`gate_passes\` WHERE gatePassNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(gatePassNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`, [likePattern]);
              let lastNum = 0;
              if ((rows as any[]).length > 0) {
                const lastGatePassNo = (rows as any[])[0].gatePassNo as string;
                const parts = lastGatePassNo.split('/');
                const suffix = parts[parts.length - 1];
                lastNum = parseInt(suffix || '0', 10) || 0;
              }
              const nextNum = lastNum + 1;
              const padded = String(nextNum).padStart(5, '0');
              data.gatePassNo = `GP/${fyLabel}/${padded}`;
            }
          } catch (err) {
            console.warn('[DB] Could not auto-generate gatePassNo:', (err as Error).message);
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

        if (tableName === "loading_slips") {
          const schemaName = process.env.DB_NAME || "u380633007_Inpidata";
          const loadingSlipColumns = [
            { column: "dispatchPlanId", type: "VARCHAR(36)" },
            { column: "slipNo", type: "VARCHAR(100)" },
            { column: "date", type: "VARCHAR(50)" },
            { column: "companyId", type: "VARCHAR(36)" },
            { column: "companyName", type: "VARCHAR(255)" },
            { column: "truckId", type: "VARCHAR(36)" },
            { column: "truckNo", type: "VARCHAR(255)" },
            { column: "invoiceId", type: "VARCHAR(36)" },
            { column: "invoiceNo", type: "VARCHAR(100)" },
            { column: "items", type: "LONGTEXT" },
            { column: "lines", type: "LONGTEXT" },
            { column: "totalQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
            { column: "totalAmount", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
            { column: "remarks", type: "TEXT" },
            { column: "updatedBy", type: "VARCHAR(255)" },
            { column: "updateTimestamp", type: "VARCHAR(255)" },
          ];

          for (const loadingSlipColumn of loadingSlipColumns) {
            try {
              await ensureColumnExists(db, schemaName, "loading_slips", loadingSlipColumn.column, loadingSlipColumn.type);
            } catch (error) {
              console.warn(
                `[DB] Could not ensure loading_slips.${loadingSlipColumn.column}:`,
                (error as Error).message
              );
            }
          }

          if (data.items == null && data.lines != null) {
            data.items = data.lines;
          }
          if (data.lines == null && data.items != null) {
            data.lines = data.items;
          }
        }

        if (tableName === "gate_passes") {
          const schemaName = process.env.DB_NAME || "u380633007_Inpidata";
          const gatePassColumns = [
            { column: "gatePassType", type: "VARCHAR(30) NOT NULL DEFAULT 'Non-Returnable'" },
            { column: "invoiceId", type: "VARCHAR(36)" },
            { column: "invoiceNo", type: "VARCHAR(100)" },
            { column: "companyId", type: "VARCHAR(36)" },
            { column: "companyName", type: "VARCHAR(255)" },
            { column: "recipientId", type: "VARCHAR(36)" },
            { column: "recipientName", type: "VARCHAR(255)" },
            { column: "recipientType", type: "VARCHAR(30)" },
            { column: "sentByUserId", type: "VARCHAR(36)" },
            { column: "sentByUserName", type: "VARCHAR(255)" },
            { column: "truckId", type: "VARCHAR(36)" },
            { column: "truckNo", type: "VARCHAR(255)" },
            { column: "loadingSlipIds", type: "JSON NOT NULL" },
            { column: "loadingSlipNos", type: "JSON NOT NULL" },
            { column: "remarks", type: "TEXT" },
            { column: "clearOffReason", type: "TEXT" },
            { column: "clearedOffAt", type: "VARCHAR(255)" },
            { column: "clearedOffBy", type: "VARCHAR(255)" },
            { column: "totalQty", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
            { column: "totalAmount", type: "DECIMAL(15,2) NOT NULL DEFAULT 0" },
            { column: "lines", type: "JSON NOT NULL" },
            { column: "updatedBy", type: "VARCHAR(255)" },
            { column: "updateTimestamp", type: "VARCHAR(255)" },
          ];
          for (const gatePassColumn of gatePassColumns) {
            try {
              await ensureColumnExists(db, schemaName, "gate_passes", gatePassColumn.column, gatePassColumn.type);
            } catch (error) {
              console.warn(`[DB] Could not ensure gate_passes.${gatePassColumn.column}:`, (error as Error).message);
            }
          }

          const gatePassType = String(data.gatePassType || "Non-Returnable").trim() || "Non-Returnable";
          data.gatePassType = gatePassType;

          if (gatePassType === "Returnable") {
            data.invoiceId = null;
            data.invoiceNo = null;
            data.companyId = null;
            data.companyName = null;
            data.loadingSlipIds = [];
            data.loadingSlipNos = [];
            data.totalAmount = 0;
            if (Array.isArray(data.lines)) {
              data.lines = data.lines.map((line: any) => ({
                ...line,
                rate: 0,
                amount: 0,
                loadingSlipIds: [],
                loadingSlipNos: [],
              }));
            }
          }

          const invoiceId = gatePassType === "Non-Returnable" ? String(data.invoiceId || "").trim() : "";
          if (invoiceId) {
            const currentId = String(data.id || "").trim();
            const [existingRows] = await db.query(
              "SELECT id, gatePassNo FROM `gate_passes` WHERE invoiceId = ? AND id <> ? LIMIT 1",
              [invoiceId, currentId]
            );
            const existingGatePass = (existingRows as any[])[0];
            if (existingGatePass) {
              return res.status(409).json({
                error: `Only one gate pass is allowed per invoice. Existing Gate Pass: ${existingGatePass.gatePassNo || existingGatePass.id}`,
              });
            }
          }
        }
        
        const keys = Object.keys(data);
        // Stringify any objects or arrays for MySQL JSON columns
        const values = Object.values(data).map(v => 
          (typeof v === "object" && v !== null) ? JSON.stringify(v) : v
        );
        
        const placeholders = keys.map(() => "?").join(",");
        const columnNames = keys.map(k => `\`${k}\``).join(",");
        const updates = keys.map(k => `\`${k}\`=VALUES(\`${k}\`)`).join(",");
        
        const query = `INSERT INTO \`${tableName}\` (${columnNames}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;

        if (tableName === "orders") {
          const approvalStatuses = new Set(["Pending Scheduling", "Scheduled"]);
          const now = new Date().toISOString();
          const itemSource = normalizeOrderItemSourceValue(data.itemSource);
          const itemId = itemSource === "FG" ? resolveLinkedNpdId(data) : String(data.itemId || "").trim();
          const rateNumber = Number(data.rate);
          const updatedBy = String(data.approvedEmail || data.updatedBy || "System").trim() || "System";

          const conn = await db.getConnection();
          try {
            await conn.beginTransaction();

            let wasApproved = false;
            const id = String(data.id || "").trim();
            if (id) {
              const [existingRows] = await conn.query(
                "SELECT status, approvedTimestamp, approvedEmail FROM `orders` WHERE id = ? LIMIT 1",
                [id]
              );
              const existing = (existingRows as any[])?.[0];
              const existingStatus = String(existing?.status || "").trim();
              const existingApproved =
                hasWorkflowValue(existing?.approvedTimestamp) || hasWorkflowValue(existing?.approvedEmail);
              wasApproved = existingApproved || approvalStatuses.has(existingStatus);
            }

            const nextStatus = String(data.status || "").trim();
            const isNowApproved =
              hasWorkflowValue(data.approvedTimestamp) ||
              hasWorkflowValue(data.approvedEmail) ||
              approvalStatuses.has(nextStatus);

            const shouldUpdateItemRate =
              !wasApproved &&
              isNowApproved &&
              itemId &&
              Number.isFinite(rateNumber) &&
              rateNumber > 0;

            console.log(`[DB] Upserting to ${tableName}`, { id: data.id });
            await conn.query(query, values);

            if (shouldUpdateItemRate) {
              if (itemSource === "PHP") {
                await conn.query(
                  "UPDATE `php_item_master` SET `rate` = ?, `updatedBy` = ?, `updateTimestamp` = ? WHERE id = ?",
                  [rateNumber, updatedBy, now, itemId]
                );
              } else if (itemSource === "PLATE") {
                await conn.query(
                  "UPDATE `plate_item_master` SET `rate` = ?, `updatedBy` = ?, `updateTimestamp` = ? WHERE id = ?",
                  [rateNumber, updatedBy, now, itemId]
                );
              } else {
                await conn.query(
                  "UPDATE `npd` SET `rate` = ?, `updatedBy` = ?, `updateTimestamp` = ? WHERE id = ?",
                  [rateNumber, updatedBy, now, itemId]
                );
              }
            }

            if (itemSource === "FG" && itemId && Number.isFinite(rateNumber) && rateNumber > 0) {
              await conn.query(
                "UPDATE `npd` SET `orderRate` = ?, `updatedBy` = ?, `updateTimestamp` = ? WHERE id = ?",
                [rateNumber, updatedBy, now, itemId]
              );
            }

            await conn.commit();
            return res.json({ success: true });
          } catch (err) {
            try {
              await conn.rollback();
            } catch {}
            throw err;
          } finally {
            conn.release();
          }
        }

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

        const blockers = await getDeleteBlockers(db, tableName, id);
        if (blockers.length) {
          const details = blockers.map((b) => `${b.label} (${b.count})`).join(", ");
          return res.status(409).json({ error: `Cannot delete ${tableName}: used in ${details}.` });
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
const entities = ["item_groups", "material_groups", "items", "materials", "tally_change_log", "indents", "indent_lines", "purchase_orders", "purchase_order_lines", "gate_entries", "gate_entry_photos", "material_in_packing_slips", "material_issues", "material_issue_lines", "material_issue_reel_lines", "material_returns", "material_return_lines", "material_return_reel_lines", "suppliers", "states", "units", "color_masters", "gst_rate_masters", "companies", "machines", "orders", "orders_schedule", "realization_rate_chart", "material_in", "users", "productions", "production_processing", "consumptions", "sample_requests", "trucks", "dispatch_plans", "loading_slips", "material_visit", "invoices", "invoice_line_items", "gate_passes", "services", "npd", "php_item_master", "plate_item_master", "php_job_master", "plate_job_master", "php_dispatch_plans", "plate_dispatch_plans", "php_loading_slips", "plate_loading_slips", "settings"];

app.get("/api/legacy-items", async (req, res) => {
  try {
    const user = await getRequestUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!hasPermission(user, "/masters/items")) return res.status(403).json({ error: "Forbidden" });

    const db = await getPool();
    if (!db) return res.status(500).json({ error: "DB connection not available" });

    const rows = await fetchLegacyItems(db);
    return res.json(rows);
  } catch (err) {
    console.error("[DB] Error fetching legacy items:", err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/purchase-orders/pending-procurement", async (req, res) => {
  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  try {
    const [rows] = await db.query(`
      SELECT 
        il.id as indentLineId,
        il.indentId,
        i.indentNo,
        il.materialId,
        il.uom,
        il.qty,
        il.cancelledQty,
        il.targetDeliveryDate,
        i.requisitionDate,
        m.name as materialName,
        m.erpCode as materialErpCode,
        COALESCE(pol_sum.poQtyCreated, 0) as poQtyCreated
      FROM indent_lines il
      JOIN indents i ON i.id = il.indentId
      JOIN materials m ON m.id = il.materialId
      LEFT JOIN (
        SELECT pol.indentLineId, SUM(pol.qty) as poQtyCreated
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchaseOrderId
        WHERE po.status != 'Rejected'
        GROUP BY pol.indentLineId
      ) pol_sum ON pol_sum.indentLineId = il.id
      WHERE i.status = 'Approved'
    `);

    const lines = (rows as any[]).map(row => ({
      indentLineId: String(row.indentLineId),
      indentId: String(row.indentId),
      indentNo: String(row.indentNo || ""),
      materialId: String(row.materialId),
      uom: String(row.uom || ""),
      qty: Number(row.qty),
      cancelledQty: Number(row.cancelledQty),
      poQtyCreated: Number(row.poQtyCreated),
      targetDeliveryDate: row.targetDeliveryDate,
      requisitionDate: row.requisitionDate,
      materialName: row.materialName,
      materialErpCode: row.materialErpCode,
      pendingQty: Math.max(0, Number(row.qty) - Number(row.cancelledQty) - Number(row.poQtyCreated))
    })).filter(row => row.pendingQty > 0);

    const merged = new Map<string, any>();
    lines.forEach(line => {
      const key = `${line.materialId}_${line.uom}`;
      if (!merged.has(key)) {
        merged.set(key, {
          materialId: line.materialId,
          materialName: line.materialName,
          materialErpCode: line.materialErpCode,
          uom: line.uom,
          totalPendingQty: 0,
          sources: []
        });
      }
      const group = merged.get(key);
      group.totalPendingQty += line.pendingQty;
      group.sources.push(line);
    });

    const mergedList = Array.from(merged.values());
    if (mergedList.length > 0) {
      const materialIds = mergedList.map(m => m.materialId);
      const [rateRows] = await db.query(`
        SELECT pol.materialId, pol.rate, po.poDate
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchaseOrderId
        WHERE pol.materialId IN (${materialIds.map(() => "?").join(",")})
        ORDER BY po.poDate DESC
      `, materialIds);

      const latestRates = new Map<string, number>();
      (rateRows as any[]).forEach(row => {
        if (!latestRates.has(row.materialId)) {
          latestRates.set(row.materialId, Number(row.rate));
        }
      });

      mergedList.forEach(m => {
        m.suggestedRate = latestRates.get(m.materialId) || 0;
      });
    }

    res.json(mergedList);
  } catch (error) {
    console.error("[API] pending-procurement failed:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/purchase-orders/pending-indent-lines", async (_req, res) => {
  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  try {
    const [rows] = await db.query(`
      SELECT 
        il.id as indentLineId,
        il.indentId,
        i.indentNo,
        i.requestedBy,
        i.requisitionDate,
        il.materialId,
        m.name as materialName,
        m.erpCode as materialErpCode,
        il.uom,
        il.qty,
        il.cancelledQty,
        il.targetDeliveryDate,
        COALESCE(pol_sum.poQtyCreated, 0) as poQtyCreated
      FROM indent_lines il
      JOIN indents i ON i.id = il.indentId
      JOIN materials m ON m.id = il.materialId
      LEFT JOIN (
        SELECT pol.indentLineId, SUM(pol.qty) as poQtyCreated
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchaseOrderId
        WHERE po.status != 'Rejected'
        GROUP BY pol.indentLineId
      ) pol_sum ON pol_sum.indentLineId = il.id
      WHERE i.status = 'Approved'
    `);

    const base = (rows as any[])
      .map((row) => {
        const qty = Number(row.qty || 0);
        const cancelledQty = Number(row.cancelledQty || 0);
        const poQtyCreated = Number(row.poQtyCreated || 0);
        const pendingQty = Math.max(0, qty - cancelledQty - poQtyCreated);
        return {
          indentLineId: String(row.indentLineId),
          indentId: String(row.indentId),
          indentNo: String(row.indentNo || ""),
          requestedBy: String(row.requestedBy || ""),
          requisitionDate: String(row.requisitionDate || ""),
          materialId: String(row.materialId),
          materialName: String(row.materialName || ""),
          materialErpCode: String(row.materialErpCode || ""),
          uom: String(row.uom || ""),
          qty,
          cancelledQty,
          poQtyCreated,
          pendingQty,
          targetDeliveryDate: String(row.targetDeliveryDate || ""),
        };
      })
      .filter((row) => row.pendingQty > 0);

    const materialIds = Array.from(new Set(base.map((r) => r.materialId))).filter(Boolean);
    const lastPoInfoByMaterial = new Map<string, { rate: number; date: string }>();
    if (materialIds.length > 0) {
      const [rateRows] = await db.query(
        `
          SELECT pol.materialId, pol.rate, po.poDate
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchaseOrderId
          WHERE po.status != 'Rejected' AND pol.materialId IN (${materialIds.map(() => "?").join(",")})
          ORDER BY po.poDate DESC
        `,
        materialIds
      );
      (rateRows as any[]).forEach((r) => {
        const mid = String(r.materialId || "");
        if (!mid || lastPoInfoByMaterial.has(mid)) return;
        lastPoInfoByMaterial.set(mid, { 
          rate: Number(r.rate || 0), 
          date: r.poDate ? String(r.poDate) : "" 
        });
      });
    }

    const result = base.map((r) => {
      const info = lastPoInfoByMaterial.get(r.materialId);
      return {
        ...r,
        suggestedRate: info?.rate || 0,
        lastPoRate: info?.rate || 0,
        lastPoDate: info?.date || "",
      };
    });

    res.json(result);
  } catch (error) {
    console.error("[API] pending-indent-lines failed:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/purchase-orders/create-from-indent-lines", async (req, res) => {
  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  const { poDate, remarks, lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "No lines provided." });
  }

  const normalizedLines = lines.map((l: any) => ({
    indentLineId: String(l.indentLineId || "").trim(),
    supplierId: String(l.supplierId || "").trim(),
    qty: Number(l.qty || 0),
    rate: Number(l.rate || 0),
  }));

  const invalid = normalizedLines.find((l: any) => !l.indentLineId || !l.supplierId || !Number.isFinite(l.qty) || l.qty <= 0 || !Number.isFinite(l.rate) || l.rate < 0);
  if (invalid) {
    return res.status(400).json({ error: "Invalid line items. Supplier, qty (>0) and rate (>=0) are required." });
  }

  const dateStr = String(poDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const lineIds = normalizedLines.map((l: any) => l.indentLineId);
    const [dbRows] = await conn.query(
      `
        SELECT 
          il.id as indentLineId,
          il.indentId,
          il.materialId,
          il.uom,
          il.qty,
          il.cancelledQty,
          il.targetDeliveryDate,
          COALESCE(pol_sum.poQtyCreated, 0) as poQtyCreated
        FROM indent_lines il
        JOIN indents i ON i.id = il.indentId
        LEFT JOIN (
          SELECT pol.indentLineId, SUM(pol.qty) as poQtyCreated
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchaseOrderId
          WHERE po.status != 'Rejected'
          GROUP BY pol.indentLineId
        ) pol_sum ON pol_sum.indentLineId = il.id
        WHERE il.id IN (${lineIds.map(() => "?").join(",")})
      `,
      lineIds
    );

    const byId = new Map<string, any>((dbRows as any[]).map((r) => [String(r.indentLineId), r]));
    for (const l of normalizedLines) {
      const row = byId.get(l.indentLineId);
      if (!row) {
        return res.status(400).json({ error: `Indent line not found: ${l.indentLineId}` });
      }
      const pendingQty = Math.max(0, Number(row.qty || 0) - Number(row.cancelledQty || 0) - Number(row.poQtyCreated || 0));
      if (l.qty > pendingQty + 0.0001) {
        return res.status(400).json({ error: `Qty exceeds pending for indent line ${l.indentLineId}. Pending: ${pendingQty}` });
      }
    }

    const groups = new Map<string, any[]>();
    normalizedLines.forEach((l: any) => {
      if (!groups.has(l.supplierId)) groups.set(l.supplierId, []);
      groups.get(l.supplierId)!.push(l);
    });

    const created: Array<{ supplierId: string; poNo: string; purchaseOrderId: string }> = [];
    const indentLinesToUpdate = new Map<string, number>();

    for (const [supplierId, groupLines] of groups.entries()) {
      const d = new Date(dateStr);
      let fyStart = d.getFullYear();
      if (d.getMonth() < 3) fyStart--;
      const fyLabel = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
      const prefix = "PO";
      const likePattern = `${prefix}/${fyLabel}/%`;
      const [poRows] = await conn.query(
        "SELECT poNo FROM `purchase_orders` WHERE poNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(poNo,'/',-1) AS UNSIGNED) DESC LIMIT 1",
        [likePattern]
      );
      let lastNum = 0;
      if ((poRows as any[]).length > 0) {
        const lastPoNo = (poRows as any[])[0].poNo;
        const parts = String(lastPoNo || "").split("/");
        lastNum = parseInt(parts[parts.length - 1], 10) || 0;
      }
      const poNo = `${prefix}/${fyLabel}/${String(lastNum + 1).padStart(5, "0")}`;

      const purchaseOrderId = crypto.randomUUID();
      let totalQty = 0;
      let totalAmount = 0;

      const poLinesToInsert: any[] = [];
      for (const l of groupLines) {
        const row = byId.get(l.indentLineId);
        const qty = Number(l.qty || 0);
        const rate = Number(l.rate || 0);
        const amount = qty * rate;
        totalQty += qty;
        totalAmount += amount;
        poLinesToInsert.push({
          id: crypto.randomUUID(),
          purchaseOrderId,
          indentLineId: l.indentLineId,
          materialId: String(row.materialId),
          uom: String(row.uom || ""),
          qty,
          rate,
          amount,
          targetDeliveryDate: String(row.targetDeliveryDate || ""),
        });
        indentLinesToUpdate.set(l.indentLineId, (indentLinesToUpdate.get(l.indentLineId) || 0) + qty);
      }

      await conn.query(
        "INSERT INTO `purchase_orders` (id, poNo, indentId, supplierId, poDate, requiredDate, totalQty, totalAmount, remarks, status, updatedBy, updateTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [purchaseOrderId, poNo, null, supplierId, dateStr, dateStr, totalQty, totalAmount, String(remarks || "").trim(), "Pending Approval", "System User", new Date().toISOString()]
      );

      for (const line of poLinesToInsert) {
        await conn.query(
          "INSERT INTO `purchase_order_lines` (id, purchaseOrderId, indentLineId, materialId, uom, qty, rate, amount, targetDeliveryDate, updatedBy, updateTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [line.id, line.purchaseOrderId, line.indentLineId, line.materialId, line.uom, line.qty, line.rate, line.amount, line.targetDeliveryDate, "System User", new Date().toISOString()]
        );
      }

      created.push({ supplierId, poNo, purchaseOrderId });
    }

    const indentIdsToCheck = new Set<string>();
    for (const [indentLineId, addQty] of indentLinesToUpdate.entries()) {
      await conn.query("UPDATE `indent_lines` SET `orderedQty` = `orderedQty` + ?, `updateTimestamp` = ? WHERE id = ?", [addQty, new Date().toISOString(), indentLineId]);
      const row = byId.get(indentLineId);
      if (row?.indentId) indentIdsToCheck.add(String(row.indentId));
    }

    for (const indentId of indentIdsToCheck) {
      const [linesRows] = await conn.query("SELECT qty, cancelledQty, orderedQty FROM `indent_lines` WHERE indentId = ?", [indentId]);
      const allDone = (linesRows as any[]).every((l) => Number(l.qty) <= (Number(l.orderedQty) + Number(l.cancelledQty)));
      if (allDone) {
        await conn.query(
          "UPDATE `indents` SET `status` = 'Completed', `completedBy` = 'System User', `completedTimestamp` = ?, `updateTimestamp` = ? WHERE id = ?",
          [new Date().toISOString(), new Date().toISOString(), indentId]
        );
      }
    }

    await conn.commit();
    return res.json({ success: true, created });
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    console.error("[API] create-from-indent-lines failed:", error);
    return res.status(500).json({ error: (error as Error).message });
  } finally {
    conn.release();
  }
});

app.post("/api/purchase-orders/create-consolidated", async (req, res) => {
  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  const { supplierId, poDate, requiredDate, remarks, items } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const dateStr = poDate || new Date().toISOString().slice(0, 10);
    const d = new Date(dateStr);
    let fyStart = d.getFullYear();
    if (d.getMonth() < 3) fyStart--;
    const fyLabel = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
    
    const prefix = "PO";
    const likePattern = `${prefix}/${fyLabel}/%`;
    const [poRows] = await conn.query(
      `SELECT poNo FROM \`purchase_orders\` WHERE poNo LIKE ? ORDER BY CAST(SUBSTRING_INDEX(poNo,'/',-1) AS UNSIGNED) DESC LIMIT 1`,
      [likePattern]
    );
    
    let lastNum = 0;
    if ((poRows as any[]).length > 0) {
      const lastPoNo = (poRows as any[])[0].poNo;
      const parts = lastPoNo.split("/");
      lastNum = parseInt(parts[parts.length - 1], 10) || 0;
    }
    const poNo = `${prefix}/${fyLabel}/${String(lastNum + 1).padStart(5, "0")}`;

    const purchaseOrderId = crypto.randomUUID();
    let totalQty = 0;
    let totalAmount = 0;
    const poLines: any[] = [];
    const indentLinesToUpdate = new Map<string, number>();

    for (const item of items) {
      const { materialId, uom, orderQty, rate } = item;
      let remainingToAllocate = Number(orderQty);

      const [sourceRows] = await conn.query(`
        SELECT 
          il.id, il.qty, il.cancelledQty, il.orderedQty, il.targetDeliveryDate, i.requisitionDate,
          COALESCE(pol_sum.poQtyCreated, 0) as poQtyCreated
        FROM indent_lines il
        JOIN indents i ON i.id = il.indentId
        LEFT JOIN (
          SELECT pol.indentLineId, SUM(pol.qty) as poQtyCreated
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchaseOrderId
          WHERE po.status != 'Rejected'
          GROUP BY pol.indentLineId
        ) pol_sum ON pol_sum.indentLineId = il.id
        WHERE i.status = 'Approved' 
          AND il.materialId = ? 
          AND il.uom = ?
          AND (il.qty - il.cancelledQty - COALESCE(pol_sum.poQtyCreated, 0)) > 0
        ORDER BY il.targetDeliveryDate ASC, i.requisitionDate ASC
      `, [materialId, uom]);

      for (const source of sourceRows as any[]) {
        if (remainingToAllocate <= 0) break;
        const pendingQty = Number(source.qty) - Number(source.cancelledQty) - Number(source.poQtyCreated || 0);
        const allocate = Math.min(remainingToAllocate, pendingQty);
        if (allocate > 0) {
          poLines.push({
            id: crypto.randomUUID(),
            purchaseOrderId,
            indentLineId: source.id,
            materialId,
            uom,
            qty: allocate,
            rate: Number(rate),
            amount: allocate * Number(rate),
            targetDeliveryDate: source.targetDeliveryDate
          });
          totalQty += allocate;
          totalAmount += allocate * Number(rate);
          remainingToAllocate -= allocate;
          const existingAdd = indentLinesToUpdate.get(source.id) || 0;
          indentLinesToUpdate.set(source.id, existingAdd + allocate);
        }
      }
    }

    if (poLines.length === 0) throw new Error("No quantities allocated to indent lines.");

    await conn.query(
      "INSERT INTO `purchase_orders` (id, poNo, indentId, supplierId, poDate, requiredDate, totalQty, totalAmount, remarks, status, updatedBy, updateTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [purchaseOrderId, poNo, null, supplierId, poDate, requiredDate || poDate, totalQty, totalAmount, remarks, "Pending Approval", "System User", new Date().toISOString()]
    );

    for (const line of poLines) {
      await conn.query(
        "INSERT INTO `purchase_order_lines` (id, purchaseOrderId, indentLineId, materialId, uom, qty, rate, amount, targetDeliveryDate, updatedBy, updateTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [line.id, line.purchaseOrderId, line.indentLineId, line.materialId, line.uom, line.qty, line.rate, line.amount, line.targetDeliveryDate, "System User", new Date().toISOString()]
      );
    }

    const indentIdsToCheck = new Set<string>();
    for (const [id, addQty] of indentLinesToUpdate.entries()) {
      await conn.query("UPDATE `indent_lines` SET `orderedQty` = `orderedQty` + ?, `updateTimestamp` = ? WHERE id = ?", [addQty, new Date().toISOString(), id]);
      const [ilRows] = await conn.query("SELECT indentId FROM `indent_lines` WHERE id = ?", [id]);
      if ((ilRows as any[]).length) indentIdsToCheck.add((ilRows as any[])[0].indentId);
    }

    for (const indentId of indentIdsToCheck) {
      const [lines] = await conn.query("SELECT qty, cancelledQty, orderedQty FROM `indent_lines` WHERE indentId = ?", [indentId]);
      const allDone = (lines as any[]).every(l => Number(l.qty) <= (Number(l.orderedQty) + Number(l.cancelledQty)));
      if (allDone) {
        await conn.query("UPDATE `indents` SET `status` = 'Completed', `completedBy` = 'System User', `completedTimestamp` = ?, `updateTimestamp` = ? WHERE id = ?", [new Date().toISOString(), new Date().toISOString(), indentId]);
      }
    }

    await conn.commit();
    res.json({ success: true, poNo, purchaseOrderId });
  } catch (error) {
    await conn.rollback();
    console.error("[API] create-consolidated failed:", error);
    res.status(500).json({ error: (error as Error).message });
  } finally {
    conn.release();
  }
});

app.post("/api/get-pending-job-closure", async (req, res) => {
  const db = await getPool();
  if (!db) return res.status(500).json({ error: "DB connection not available" });

  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!hasPermission(user, "/production")) return res.status(403).json({ error: "Forbidden" });

  const filters = (req.body || {}) as {
    date_from?: string;
    date_to?: string;
    machine_id?: string;
    type?: string;
    job_no?: string;
    company?: string;
  };

  try {
    const [settingsRows] = await db.query("SELECT * FROM `settings` LIMIT 1");
    const setting = (settingsRows as any[])[0];
    const mandatoryByType = parseMandatoryMachinesByType(setting);

    const [machinesRows] = await db.query("SELECT id, name FROM `machines`");
    const machines = (machinesRows as any[]).map((m) => ({
      id: String(m.id),
      name: normalizeMachineName(String(m.name || "")),
    }));
    const machineIdByName = new Map(machines.map((m) => [m.name.toLowerCase(), m.id]));

    const where: string[] = ["(status IS NULL OR status NOT IN ('Completed','Cancelled'))"];
    const params: any[] = [];

    if (filters.date_from) {
      where.push("STR_TO_DATE(`date`, '%Y-%m-%d') >= STR_TO_DATE(?, '%Y-%m-%d')");
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      where.push("STR_TO_DATE(`date`, '%Y-%m-%d') <= STR_TO_DATE(?, '%Y-%m-%d')");
      params.push(filters.date_to);
    }
    if (filters.job_no) {
      where.push("LOWER(`transactionNo`) LIKE LOWER(?)");
      params.push(`%${filters.job_no}%`);
    }

    const [productionRows] = await db.query(
      `SELECT * FROM \`productions\` ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY transactionNo DESC`,
      params
    );
    const productions = productionRows as any[];

    const productionIds = productions.map((p) => String(p.id));
    const scheduleIds = productions.map((p) => String(p.scheduleId || "")).filter(Boolean);
    const itemIds = productions.map((p) => normalizeItemLookupId(p)).filter(Boolean);

    const [itemsRows] = itemIds.length
      ? await db.query(`SELECT id, itemName, boxType FROM \`npd\` WHERE id IN (${itemIds.map(() => "?").join(",")})`, itemIds)
      : ([[]] as any);
    const itemsById = new Map((itemsRows as any[]).map((row) => [String(row.id), row]));

    const [schedulesRows] = scheduleIds.length
      ? await db.query(`SELECT id, orderId FROM \`orders_schedule\` WHERE id IN (${scheduleIds.map(() => "?").join(",")})`, scheduleIds)
      : ([[]] as any);
    const schedulesById = new Map((schedulesRows as any[]).map((row) => [String(row.id), row]));

    const orderIds = (schedulesRows as any[]).map((s) => String(s.orderId || "")).filter(Boolean);
    const [ordersRows] = orderIds.length
      ? await db.query(`SELECT id, orderNo, companyId FROM \`orders\` WHERE id IN (${orderIds.map(() => "?").join(",")})`, orderIds)
      : ([[]] as any);
    const ordersById = new Map((ordersRows as any[]).map((row) => [String(row.id), row]));

    const companyIds = (ordersRows as any[]).map((o) => String(o.companyId || "")).filter(Boolean);
    const [companiesRows] = companyIds.length
      ? await db.query(`SELECT id, name FROM \`companies\` WHERE id IN (${companyIds.map(() => "?").join(",")})`, companyIds)
      : ([[]] as any);
    const companiesById = new Map((companiesRows as any[]).map((row) => [String(row.id), row]));

    const [processingRows] = productionIds.length
      ? await db.query(
          `SELECT productionId, machineId, machineName, shift, qty, operatorId, date FROM \`production_processing\` WHERE productionId IN (${productionIds
            .map(() => "?")
            .join(",")})`,
          productionIds
        )
      : ([[]] as any);

    const processingByProductionId = new Map<string, any[]>();
    (processingRows as any[]).forEach((row) => {
      const key = String(row.productionId);
      const list = processingByProductionId.get(key) || [];
      list.push({
        ...row,
        machineName: normalizeMachineName(String(row.machineName || "")),
      });
      processingByProductionId.set(key, list);
    });

    const isCorrugationLiner = (machineName: string) =>
      String(machineName || "").trim().toLowerCase() === "corrugation liner";

    const requiredFieldsByStep = {
      machineId: "Machine",
      operatorId: "Operator",
      shift: "Shift",
      date: "Date",
      qty: "Quantity",
    } as const;

    const rows = productions
      .map((p) => {
        const productionId = String(p.id);
        const planQty = Number(p.qty || 0);
        const planDate = String(p.date || "");

        const item = itemsById.get(normalizeItemLookupId(p));
        const typeName = String(item?.boxType || "").trim();
        const itemName = String(item?.itemName || "").trim();

        const schedule = schedulesById.get(String(p.scheduleId || ""));
        const order = schedule ? ordersById.get(String(schedule.orderId || "")) : undefined;
        const orderNo = String(order?.orderNo || "").trim();
        const company = order ? companiesById.get(String(order.companyId || "")) : undefined;
        const companyName = String(company?.name || "").trim();

        if (filters.company && companyName && !companyName.toLowerCase().includes(String(filters.company).toLowerCase())) {
          return null;
        }
        if (filters.type && typeName && typeName.toLowerCase() !== String(filters.type).toLowerCase()) {
          return null;
        }

        const requiredSteps = (mandatoryByType[typeName] || []).map((name) => normalizeMachineName(name));
        const records = processingByProductionId.get(productionId) || [];
        const normalizedRecords = records.map((r) => ({
          ...r,
          machineName: normalizeMachineName(String(r.machineName || "")),
        }));

        const missingSteps: { stepKey: string; machineName: string; machineId?: string }[] = [];
        const missingFields: { stepKey: string; machineName: string; machineId?: string; fields: string[] }[] = [];
        const blockingReasons: string[] = [];

        if (requiredSteps.length === 0) {
          blockingReasons.push(`No required process steps configured for Type: ${typeName || "-"}`);
        }

        requiredSteps.forEach((stepMachineName) => {
          const stepKey = stepMachineName;
          const normalizedStep = normalizeMachineName(stepMachineName);
          const machineId = machineIdByName.get(normalizedStep.toLowerCase());
          const stepRecords = normalizedRecords.filter(
            (r) => normalizeMachineName(String(r.machineName || "")) === normalizedStep
          );

          if (stepRecords.length === 0) {
            missingSteps.push({ stepKey, machineName: normalizedStep, machineId });
            return;
          }

          const completedRecord = stepRecords.find((r) => {
            const qtyValue = Number(r.qty || 0);
            if (!Number.isFinite(qtyValue) || qtyValue <= 0) return false;
            if (!String(r.machineId || "").trim()) return false;
            if (!String(r.operatorId || "").trim()) return false;
            if (!String(r.shift || "").trim()) return false;
            if (!String(r.date || "").trim()) return false;
            return true;
          });

          if (!completedRecord) {
            const fields = new Set<string>();
            stepRecords.forEach((r) => {
              Object.entries(requiredFieldsByStep).forEach(([key, label]) => {
                const value = (r as any)[key];
                if (key === "qty") {
                  const qtyValue = Number(value || 0);
                  if (!Number.isFinite(qtyValue) || qtyValue <= 0) fields.add(label);
                  return;
                }
                if (!String(value || "").trim()) fields.add(label);
              });
            });
            missingFields.push({ stepKey, machineName: normalizedStep, machineId, fields: Array.from(fields) });
          }

          if (!isCorrugationLiner(normalizedStep) && planQty > 0) {
            const stepQty = stepRecords.reduce((sum, r) => sum + Number(r.qty || 0), 0);
            if (stepQty > planQty) {
              blockingReasons.push(`Qty exceeds Plan Qty for ${normalizedStep} (Plan ${planQty}, Reported ${stepQty})`);
            }
          }
        });

        if (missingSteps.length) blockingReasons.push(`Missing processing steps: ${missingSteps.map((s) => s.machineName).join(", ")}`);
        if (missingFields.length) blockingReasons.push(`Incomplete processing entries: ${missingFields.map((s) => s.machineName).join(", ")}`);

        if (!blockingReasons.length) return null;

        const machineSet = new Set<string>();
        [...missingSteps, ...missingFields].forEach((s) => {
          if (s.machineName) machineSet.add(s.machineName);
        });

        const groupMachineName =
          machineSet.size === 0 ? "Unassigned" : machineSet.size === 1 ? [...machineSet][0] : "Multiple/Various";
        const groupMachineId =
          groupMachineName && groupMachineName !== "Multiple/Various" && groupMachineName !== "Unassigned"
            ? machineIdByName.get(groupMachineName.toLowerCase())
            : undefined;

        if (filters.machine_id && groupMachineId !== filters.machine_id) {
          return null;
        }

        const processedQty = normalizedRecords.reduce((sum, r) => sum + Number(r.qty || 0), 0);
        const exceededBy = planQty > 0 ? Math.max(0, processedQty - planQty) : 0;

        return {
          productionId,
          jobNo: String(p.transactionNo || ""),
          orderNo,
          itemName,
          companyName,
          typeName,
          planQty,
          planDate,
          blockingReasons,
          missingSteps,
          missingFields,
          qtyStatus: { planQty, processedQty, exceededBy },
          groupMachineName,
          groupMachineId,
        };
      })
      .filter(Boolean);

    res.json(rows);
  } catch (error) {
    console.error("[API] get-pending-job-closure failed:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

entities.forEach(entity => {
  const handlers = createHandlers(entity);
  const route = `/api/${entity.replace(/_/g, "-")}`;

  const guard = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      if (entity === "users") {
        if (req.method === "GET") return next();
        if (user.role !== "Admin") return res.status(403).json({ error: "Forbidden" });
        return next();
      }

      const required = entityPermissionKey(entity);
      if (!required) {
        if (user.role !== "Admin") return res.status(403).json({ error: "Forbidden" });
        return next();
      }

      if (user.role === "Operator") {
        if (entity === "production_processing") {
          if (req.method === "DELETE") return res.status(403).json({ error: "Forbidden" });
        } else if (req.method !== "GET") {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      if (!hasPermission(user, required)) return res.status(403).json({ error: "Forbidden" });
      return next();
    } catch (err) {
      console.error("[AUTHZ] guard failed:", err);
      return res.status(500).json({ error: "Authorization failed" });
    }
  };

  app.get(route, guard, handlers.getAll);
  app.post(route, guard, handlers.upsert);
  app.delete(`${route}/:id`, guard, handlers.delete);
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
