import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  try {
    const [columns] = await connection.query("DESCRIBE `companies`");
    console.log("=== COMPANIES COLUMNS ===");
    console.log(columns);

    const [rows] = await connection.query("SELECT * FROM `companies` LIMIT 5");
    console.log("=== COMPANIES ROWS ===");
    console.log(rows);
  } catch (error) {
    console.error("Error running query:", error);
  } finally {
    await connection.end();
  }
}

main();
