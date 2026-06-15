import mysql.connector
import json
import os
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv('DB_HOST', '193.203.184.152')
DB_USER = os.getenv('DB_USER', 'u380633007_lnpidata')
DB_PASSWORD = os.getenv('DB_PASSWORD', '!Office1@')
DB_NAME = os.getenv('DB_NAME', 'u380633007_lnpidata')

conn = mysql.connector.connect(
    host=DB_HOST,
    user=DB_USER,
    password=DB_PASSWORD,
    database=DB_NAME,
    port=3306
)

cursor = conn.cursor(dictionary=True)
mrr_id = "c2884189-074b-4ed6-aa0b-c4ceb6deb635"
cursor.execute("SELECT * FROM material_in WHERE id = %s", (mrr_id,))
row = cursor.fetchone()

if row:
    print(f"Transaction No: {row['transactionNo']}")
    print(f"Invoice No: {row['invoiceNo']}")
    print(f"Status: {row['status']}")
    print(f"Tally Timestamp: {row['tallyTimestamp']}")
    print(f"Lines: {row['lines']}")
    
    lines = json.loads(row['lines'])
    for line in lines:
        item_id = line.get('itemId')
        cursor.execute("SELECT name FROM materials WHERE id = %s", (item_id,))
        m_row = cursor.fetchone()
        if m_row:
            print(f"Item ID: {item_id}, Name: {m_row['name']}")
        else:
            cursor.execute("SELECT itemName as name FROM npd WHERE id = %s", (item_id,))
            n_row = cursor.fetchone()
            if n_row:
                print(f"Item ID: {item_id}, Name: {n_row['name']} (NPD)")
            else:
                print(f"Item ID: {item_id}, Name: Not Found")

conn.close()
