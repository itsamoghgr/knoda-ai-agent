"""
Seed script: creates a sample TPC-H DuckDB database for testing the discovery agent.

Usage:
    python docker/seed_tpch.py

This creates examples/tpch/tpch.duckdb with the standard TPC-H schema
(orders, customer, lineitem, part, supplier, partsupp, nation, region)
loaded with scale factor 0.01 (small but realistic).
"""

import os
import pathlib

import duckdb

OUTPUT_DIR = pathlib.Path(__file__).parent.parent / "examples" / "tpch"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = OUTPUT_DIR / "tpch.duckdb"

if DB_PATH.exists():
    DB_PATH.unlink()

print(f"Creating TPC-H database at {DB_PATH} ...")

conn = duckdb.connect(str(DB_PATH))

# Load TPC-H extension and generate data at scale factor 0.01
conn.execute("INSTALL tpch")
conn.execute("LOAD tpch")
conn.execute("CALL dbgen(sf=0.01)")

tables = conn.execute("SHOW TABLES").fetchall()
print(f"Created {len(tables)} tables:")
for (name,) in tables:
    count = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
    print(f"  {name}: {count:,} rows")

conn.close()
print(f"\nDone. Connect the agent to: duckdb://{DB_PATH}")
