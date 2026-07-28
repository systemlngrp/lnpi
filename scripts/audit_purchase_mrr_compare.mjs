import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DEFAULT_INPUT = path.resolve(
  process.env.USERPROFILE || "C:\\Users\\Admin",
  ".codex",
  "attachments",
  "d6fcf446-00af-4c72-a799-b9a31198c27e",
  "pasted-text.txt",
);
const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT);
const outputPath = path.resolve(process.argv[3] || "audit_purchase_mrr_comparison.csv");

function parseMoney(value) {
  const text = String(value || "").trim();
  if (!text || text === "<missing>") return null;
  const cleaned = text.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatDate(raw) {
  const text = String(raw || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text;
}

function getField(line, name) {
  const match = line.match(new RegExp(`(?:^|\\|)\\s*${name}=([^|]*)`));
  return match ? match[1].trim() : "";
}

function isValidMrr(value) {
  const text = String(value || "").trim();
  return text !== "1" && /^MI\/\d{2}-\d{2}\/\d+$/i.test(text);
}

function isCompletedStatus(value) {
  return String(value || "").trim().toLowerCase() === "completed";
}

function parsePurchaseRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      voucher: getField(line, "voucher"),
      date: formatDate(getField(line, "date")),
      type: getField(line, "type"),
      beforeGst: parseMoney(getField(line, "beforeGST")),
      afterGst: parseMoney(getField(line, "afterGST")),
      mrr: getField(line, "mrr"),
      amount: parseMoney(getField(line, "amount")),
    }))
    .filter((row) => row.type.toLowerCase() === "purchase");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function appValue(row) {
  return roundMoney(
    Number(row.totalInvoiceValueAfterGst || 0) +
      Number(row.insurance || 0) +
      Number(row.otherCharges || 0) -
      Number(row.roundOff || 0),
  );
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);

  const purchaseRows = parsePurchaseRows(fs.readFileSync(inputPath, "utf8"));
  const mrrRows = purchaseRows.filter((row) => isValidMrr(row.mrr));
  const noMrrRows = purchaseRows.filter((row) => !isValidMrr(row.mrr));
  const mrrNos = [...new Set(mrrRows.map((row) => row.mrr))];

  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [appRows] = await pool.query(
      `SELECT transactionNo, invoiceNo, mrrType, date, status, totalInvoiceValueAfterGst, insurance, otherCharges, roundOff
       FROM material_in
       WHERE (
         ${mrrNos.length ? "transactionNo IN (?) OR" : ""}
         (TRIM(transactionNo) <> '1'
          AND LOWER(TRIM(status)) = 'completed'
          AND COALESCE(NULLIF(TRIM(tallyTimestamp), ''), '') <> '')
       )`,
      mrrNos.length ? [mrrNos] : [],
    );

    const completedAppRows = appRows.filter((row) => String(row.transactionNo || "").trim() !== "1" && isCompletedStatus(row.status));
    const excludedAppRows = appRows.length - completedAppRows.length;
    const appByMrr = new Map(completedAppRows.map((row) => [String(row.transactionNo || "").trim(), row]));
    const tallyByMrr = new Map();
    for (const row of mrrRows) {
      const current = tallyByMrr.get(row.mrr) || { ...row, amount: 0, vouchers: [], dates: [] };
      current.amount = roundMoney(Number(current.amount || 0) + Number(row.amount || 0));
      current.vouchers.push(row.voucher);
      current.dates.push(row.date);
      tallyByMrr.set(row.mrr, current);
    }

    const output = [];
    for (const [mrr, tally] of tallyByMrr.entries()) {
      const app = appByMrr.get(mrr);
      if (!app) {
        output.push(["Tally MRR Not In App", "", "", "", "", "", "", mrr, tally.vouchers.join("; "), tally.dates.join("; "), roundMoney(tally.amount), roundMoney(-tally.amount)]);
        continue;
      }
      const appAmount = appValue(app);
      const tallyAmount = roundMoney(tally.amount);
      const difference = roundMoney(appAmount - tallyAmount);
      output.push([
        difference === 0 ? "Matched" : "Value Difference",
        app.transactionNo,
        app.invoiceNo,
        app.mrrType,
        app.date,
        app.status,
        appAmount,
        mrr,
        tally.vouchers.join("; "),
        tally.dates.join("; "),
        tallyAmount,
        difference,
      ]);
    }

    for (const app of completedAppRows) {
      const mrr = String(app.transactionNo || "").trim();
      if (!tallyByMrr.has(mrr)) {
        const amount = appValue(app);
        output.push(["App Only", app.transactionNo, app.invoiceNo, app.mrrType, app.date, app.status, amount, "", "", "", "", amount]);
      }
    }

    for (const row of noMrrRows) {
      output.push(["Tally Purchase Without Valid MRR", "", "", "", "", "", "", row.mrr || "<none>", row.voucher, row.date, roundMoney(row.amount || 0), roundMoney(-(row.amount || 0))]);
    }

    output.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Math.abs(Number(b[11] || 0)) - Math.abs(Number(a[11] || 0)));

    const header = ["Mismatch Type", "App MRR No", "App Invoice No", "App MRR Type", "App Date", "App Status", "App Value", "Tally MRR No", "Tally Voucher", "Tally Date", "Tally Amount", "Difference"];
    fs.writeFileSync(outputPath, [header, ...output].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");

    const matched = output.filter((row) => row[0] === "Matched").length;
    const differences = output.filter((row) => row[0] === "Value Difference").length;
    const tallyMissingApp = output.filter((row) => row[0] === "Tally MRR Not In App").length;
    const tallyNoMrr = output.filter((row) => row[0] === "Tally Purchase Without Valid MRR").length;
    console.log(`Purchase rows: ${purchaseRows.length}`);
    console.log(`Purchase rows with valid MRR: ${mrrRows.length}`);
    console.log(`Matched: ${matched}`);
    console.log(`Value differences: ${differences}`);
    console.log(`Tally MRR not in app: ${tallyMissingApp}`);
    console.log(`Tally purchase without valid MRR: ${tallyNoMrr}`);
    console.log(`App MRR rows excluded because MRR is 1 or status is not Completed: ${excludedAppRows}`);
    console.log(`Output: ${outputPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
