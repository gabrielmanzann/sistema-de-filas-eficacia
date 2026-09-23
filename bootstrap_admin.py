"""Cria o primeiro gestor de forma idempotente e sem senha no SQL."""

import os
import sys

import mysql.connector
from werkzeug.security import generate_password_hash

from db import connection


def required_env(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Defina a variavel de ambiente {name}.")
    return value


def main():
    name = " ".join(required_env("INITIAL_ADMIN_NAME").split())
    password = required_env("INITIAL_ADMIN_PASSWORD")
    if len(name) > 100:
        raise ValueError("INITIAL_ADMIN_NAME deve ter no maximo 100 caracteres.")
    if len(password) < 12:
        raise ValueError("INITIAL_ADMIN_PASSWORD deve ter ao menos 12 caracteres.")
    if len(password) > 128:
        raise ValueError("INITIAL_ADMIN_PASSWORD deve ter no maximo 128 caracteres.")

    try:
        with connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, tipo_usuario FROM usuarios WHERE LOWER(nome) = LOWER(%s)", (name,))
            existing_user = cursor.fetchone()
            if existing_user:
                if existing_user[1] != "GESTOR":
                    raise ValueError("Ja existe um usuario com esse nome que nao e gestor.")
                print("Gestor inicial ja existe; nenhuma alteracao foi feita.")
                return
            cursor.execute(
                "INSERT INTO usuarios (nome, senha, tipo_usuario, ativo) VALUES (%s, %s, 'GESTOR', TRUE)",
                (name, generate_password_hash(password)),
            )
            conn.commit()
        print(f"Gestor '{name}' criado com sucesso.")
    except mysql.connector.Error as exc:
        print(f"Nao foi possivel criar o gestor: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
