import mysql.connector
import os
import json
from dotenv import load_dotenv

load_dotenv()

conn = mysql.connector.connect(
    host=os.getenv('DB_HOST'),
    user=os.getenv('DB_USER'),
    password=os.getenv('DB_PASSWORD'),
    database=os.getenv('DB_NAME'),
    port=3306
)

cursor = conn.cursor(dictionary=True)
mrr_id = '7dce99e9-7253-43ad-a302-78cd8b8fc336'

print("--- JSON ---")
cursor.execute("SELECT `lines` FROM material_in WHERE id = %s", (mrr_id,))
row = cursor.fetchone()
if row:
    print(row['lines'])

print("\n--- TABLE ---")
cursor.execute("SELECT * FROM material_in_lines WHERE material_in_id = %s", (mrr_id,))
rows = cursor.fetchall()
for r in rows:
    print(r)

conn.close()
