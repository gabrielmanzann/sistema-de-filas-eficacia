"""Gera um dump MySQL completo usando as credenciais definidas no .env."""

import argparse
import math
import re
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

from db import connection


def quote_identifier(identifier):
    return f"`{identifier.replace('`', '``')}`"


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("O MySQL nao suporta NaN ou infinito em um dump SQL.")
        return repr(value)
    if isinstance(value, datetime):
        value = value.strftime("%Y-%m-%d %H:%M:%S.%f")
    elif isinstance(value, date):
        value = value.isoformat()
    elif isinstance(value, time):
        value = value.isoformat()
    else:
        value = str(value)
    escaped = (
        value.replace("\\", "\\\\")
        .replace("\x00", "\\0")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\x1a", "\\Z")
        .replace("'", "\\'")
    )
    return f"'{escaped}'"


def table_order(cursor):
    cursor.execute(
        """SELECT TABLE_NAME
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME"""
    )
    tables = [row[0] for row in cursor.fetchall()]
    table_set = set(tables)
    cursor.execute(
        """SELECT TABLE_NAME, REFERENCED_TABLE_NAME
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE CONSTRAINT_SCHEMA = DATABASE()
             AND REFERENCED_TABLE_NAME IS NOT NULL"""
    )
    dependencies = {table: set() for table in tables}
    for table, referenced_table in cursor.fetchall():
        if table in table_set and referenced_table in table_set:
            dependencies[table].add(referenced_table)

    ordered, remaining = [], set(tables)
    while remaining:
        ready = sorted(table for table in remaining if dependencies[table].issubset(ordered))
        if not ready:
            # Nao ha ciclos no schema atual; este fallback atende um banco com
            # referencias circulares, pois o restore desativa FKs temporariamente.
            ready = sorted(remaining)
        ordered.extend(ready)
        remaining.difference_update(ready)
    return ordered


def safe_filename(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name)


def write_table_data(cursor, output, table_name):
    cursor.execute(f"SELECT * FROM {quote_identifier(table_name)}")
    column_names = [quote_identifier(name) for name in cursor.column_names]
    prefix = f"INSERT INTO {quote_identifier(table_name)} ({', '.join(column_names)}) VALUES\n"
    while rows := cursor.fetchmany(500):
        output.write(prefix)
        output.write(",\n".join(
            "(" + ", ".join(sql_value(value) for value in row) + ")" for row in rows
        ))
        output.write(";\n\n")


def main():
    parser = argparse.ArgumentParser(description="Exporta estrutura e dados do banco MySQL atual.")
    parser.add_argument("-o", "--output", type=Path, help="Arquivo SQL de destino.")
    args = parser.parse_args()

    with connection() as conn:
        conn.start_transaction(consistent_snapshot=True, readonly=True)
        cursor = conn.cursor()
        cursor.execute("SELECT DATABASE()")
        database_name = cursor.fetchone()[0]
        if not database_name:
            raise RuntimeError("A conexao nao selecionou nenhum banco de dados.")
        tables = table_order(cursor)
        output_path = args.output or Path(
            f"backup_{safe_filename(database_name)}_{datetime.now():%Y-%m-%d_%H%M%S}.sql"
        )
        output_path = output_path.resolve()

        with output_path.open("x", encoding="utf-8", newline="\n") as output:
            output.write("-- Backup completo do Sistema de Fila de Auditoria\n")
            output.write(f"-- Gerado em {datetime.now():%Y-%m-%d %H:%M:%S}\n\n")
            output.write("SET NAMES utf8mb4;\n")
            output.write("SET FOREIGN_KEY_CHECKS = 0;\n\n")
            output.write(f"CREATE DATABASE IF NOT EXISTS {quote_identifier(database_name)} ")
            output.write("CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n")
            output.write(f"USE {quote_identifier(database_name)};\n\n")

            for table_name in reversed(tables):
                output.write(f"DROP TABLE IF EXISTS {quote_identifier(table_name)};\n")
            output.write("\n")

            for table_name in tables:
                cursor.execute(f"SHOW CREATE TABLE {quote_identifier(table_name)}")
                create_statement = cursor.fetchone()[1]
                output.write(create_statement + ";\n\n")
                write_table_data(cursor, output, table_name)

            output.write("SET FOREIGN_KEY_CHECKS = 1;\n")
        conn.rollback()

    print(f"Backup completo criado em: {output_path}")


if __name__ == "__main__":
    main()
