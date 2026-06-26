import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const APPLY = process.argv.includes("--apply");

function s(value) {
  return String(value ?? "").trim();
}

function parseMixedDate(value) {
  const raw = s(value);
  if (!raw) return 0;

  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return iso;

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return 0;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const ts = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second);
  return Number.isFinite(ts) ? ts : 0;
}

function rankRow(row, refCountById) {
  return {
    refCount: refCountById.get(s(row.id)) || 0,
    lastTs: Math.max(
      parseMixedDate(row.updateTimestamp),
      parseMixedDate(row.timestamp),
      parseMixedDate(row.date)
    ),
    hasItemName: s(row.itemName) ? 1 : 0,
  };
}

function compareRows(a, b, refCountById) {
  const scoreA = rankRow(a, refCountById);
  const scoreB = rankRow(b, refCountById);
  if (scoreB.refCount !== scoreA.refCount) return scoreB.refCount - scoreA.refCount;
  if (scoreB.lastTs !== scoreA.lastTs) return scoreB.lastTs - scoreA.lastTs;
  if (scoreB.hasItemName !== scoreA.hasItemName) return scoreB.hasItemName - scoreA.hasItemName;
  return s(a.id).localeCompare(s(b.id));
}

async function main() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 4,
  });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [npdRows] = await conn.query(`
      SELECT id, npdId, erp, itemName, customerName, timestamp, date, updateTimestamp, syncStatus
      FROM npd
    `);

    const [refRows] = await conn.query(`
      SELECT masterId, COUNT(*) AS refCount
      FROM (
        SELECT CAST(COALESCE(NULLIF(npdId, ''), itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId FROM orders
        UNION ALL
        SELECT CAST(COALESCE(NULLIF(npdId, ''), itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId FROM productions
        UNION ALL
        SELECT CAST(COALESCE(NULLIF(npdId, ''), itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId FROM invoice_line_items
        UNION ALL
        SELECT CAST(COALESCE(NULLIF(npdId, ''), itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId FROM sample_requests
        UNION ALL
        SELECT CAST(COALESCE(NULLIF(npdId, ''), itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId FROM consumptions
        UNION ALL
        SELECT CAST(COALESCE(NULLIF(jt.npdId, ''), jt.itemId) AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS masterId
        FROM material_in mi
        JOIN JSON_TABLE(
          mi.lines,
          '$[*]' COLUMNS (
            npdId VARCHAR(36) PATH '$.npdId',
            itemId VARCHAR(36) PATH '$.itemId'
          )
        ) jt
      ) refs
      WHERE COALESCE(NULLIF(TRIM(masterId), ''), '') <> ''
      GROUP BY masterId
    `);

    const refCountById = new Map((refRows || []).map((row) => [s(row.masterId), Number(row.refCount || 0)]));
    const groups = new Map();
    const blankGarbageIds = [];

    for (const row of npdRows || []) {
      const erp = s(row.erp);
      const itemName = s(row.itemName);
      const customerName = s(row.customerName);
      if (!erp) {
        if (!itemName && !customerName) {
          blankGarbageIds.push(s(row.id));
        }
        continue;
      }
      if (!groups.has(erp)) groups.set(erp, []);
      groups.get(erp).push(row);
    }

    const duplicateToCanonical = new Map();
    const duplicateGroups = [];

    for (const [erp, rows] of groups.entries()) {
      if (rows.length <= 1) continue;
      rows.sort((a, b) => compareRows(a, b, refCountById));
      const canonical = rows[0];
      const duplicates = rows.slice(1);
      duplicateGroups.push({
        erp,
        canonical: { id: s(canonical.id), npdId: s(canonical.npdId), itemName: s(canonical.itemName) },
        duplicates: duplicates.map((row) => ({ id: s(row.id), npdId: s(row.npdId), itemName: s(row.itemName) })),
      });
      for (const row of duplicates) {
        duplicateToCanonical.set(s(row.id), s(canonical.id));
      }
    }

    const summary = {
      apply: APPLY,
      totalRows: Number(npdRows.length || 0),
      duplicateErpGroups: duplicateGroups.length,
      duplicateRowsToDelete: duplicateToCanonical.size,
      blankGarbageRowsToDelete: blankGarbageIds.length,
      sampleGroups: duplicateGroups.slice(0, 10),
    };

    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      await conn.rollback();
      return;
    }

    const directTables = ["orders", "productions", "invoice_line_items", "sample_requests", "consumptions"];
    for (const [fromId, toId] of duplicateToCanonical.entries()) {
      for (const table of directTables) {
        await conn.query(
          `UPDATE \`${table}\` SET \`npdId\` = ?, \`itemId\` = ? WHERE \`npdId\` = ? OR \`itemId\` = ?`,
          [toId, toId, fromId, fromId]
        );
      }
    }

    const [materialInRows] = await conn.query("SELECT `id`, `lines` FROM `material_in`");
    let materialInUpdated = 0;
    for (const row of materialInRows || []) {
      const rawLines = typeof row.lines === "string" ? JSON.parse(row.lines) : row.lines;
      if (!Array.isArray(rawLines)) continue;
      let changed = false;
      const nextLines = rawLines.map((line) => {
        const currentId = s(line?.npdId || line?.itemId);
        const nextId = duplicateToCanonical.get(currentId);
        if (!nextId) return line;
        changed = true;
        return {
          ...line,
          npdId: nextId,
          itemId: nextId,
        };
      });
      if (!changed) continue;
      await conn.query("UPDATE `material_in` SET `lines` = ? WHERE `id` = ?", [JSON.stringify(nextLines), s(row.id)]);
      materialInUpdated += 1;
    }

    const duplicateIds = [...duplicateToCanonical.keys()];
    if (duplicateIds.length > 0) {
      await conn.query(`DELETE FROM npd WHERE id IN (${duplicateIds.map(() => "?").join(", ")})`, duplicateIds);
    }

    if (blankGarbageIds.length > 0) {
      await conn.query(`DELETE FROM npd WHERE id IN (${blankGarbageIds.map(() => "?").join(", ")})`, blankGarbageIds);
    }

    await conn.query(`
      UPDATE npd
      SET syncStatus = 'active',
          syncSource = 'google_sheets',
          updatedBy = 'NPD ERP Dedup Cleanup',
          updateTimestamp = ?
    `, [new Date().toISOString()]);

    const [postRows] = await conn.query(`
      SELECT
        COUNT(*) AS totalRows,
        COUNT(DISTINCT NULLIF(TRIM(erp), '')) AS uniqueErps
      FROM npd
    `);

    await conn.commit();
    console.log(JSON.stringify({
      ...summary,
      materialInUpdated,
      after: postRows[0],
    }, null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
