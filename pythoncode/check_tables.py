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
mrr_id = 'eb7cfba9-2f11-4e01-96cc-4741078325b0'

print("--- Data from material_in ---")
cursor.execute("SELECT `lines` FROM material_in WHERE id = %s", (mrr_id,))
row = cursor.fetchone()
if row:
    print(row['lines'])

print("\n--- Data from material_in_lines ---")
cursor.execute("SELECT * FROM material_in_lines WHERE material_in_id = %s", (mrr_id,))
rows = cursor.fetchall()
for r in rows:
    print(r)

print("\n--- Data from material_in_packing_slips (Summary) ---")
cursor.execute("SELECT count(*) as count, sum(weightKg) as totalWeight FROM material_in_packing_slips WHERE materialInId = %s", (mrr_id,))
row = cursor.fetchone()
print(row)

conn.close()
