"""Importa o schema de producao usando as mesmas credenciais da aplicacao."""

from pathlib import Path

from db import connection


SCHEMA_PATH = Path(__file__).with_name("schema_render.sql")


def sql_statements(sql):
    """O schema nao contem procedures; portanto ';' delimita cada comando."""
    without_line_comments = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    return [statement.strip() for statement in without_line_comments.split(";") if statement.strip()]


def main():
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with connection() as conn:
        cursor = conn.cursor()
        for statement in sql_statements(schema):
            cursor.execute(statement)
        conn.commit()
    print("Schema de producao aplicado com sucesso.")


if __name__ == "__main__":
    main()
