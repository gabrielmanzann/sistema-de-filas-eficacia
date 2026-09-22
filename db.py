import os
from contextlib import contextmanager

import mysql.connector
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "fila_auditoria_eficacia"),
        charset="utf8mb4",
    )


@contextmanager
def connection():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()
