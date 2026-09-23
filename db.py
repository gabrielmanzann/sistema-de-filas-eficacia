import os
from contextlib import contextmanager

import mysql.connector
from dotenv import load_dotenv

load_dotenv()


def env_bool(name, default=False):
    """Converte variaveis booleanas do .env sem aceitar valores ambiguos."""
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} deve ser true ou false.")


def get_connection():
    host = os.getenv("DB_HOST", "localhost")
    ssl_ca = os.getenv("DB_SSL_CA", "").strip()
    # Hosts do Aiven terminam em aivencloud.com; habilitar TLS por padrao nesse
    # caso evita que uma configuracao incompleta tente conexao sem criptografia.
    ssl_enabled = env_bool("DB_SSL_ENABLED", host.endswith(".aivencloud.com"))
    ssl_verify_cert = env_bool("DB_SSL_VERIFY_CERT", bool(ssl_ca))
    ssl_verify_identity = env_bool("DB_SSL_VERIFY_IDENTITY", False)
    if ssl_verify_identity and not ssl_verify_cert:
        raise ValueError("DB_SSL_VERIFY_IDENTITY exige DB_SSL_VERIFY_CERT=true.")

    config = {
        "host": host,
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "fila_auditoria_eficacia"),
        "charset": "utf8mb4",
        "connection_timeout": int(os.getenv("DB_CONNECTION_TIMEOUT", "10")),
    }
    if ssl_enabled:
        # Equivalente ao ssl_verify_cert=false na string de conexao: usa TLS,
        # mas nao exige o arquivo CA. Para producao, prefira configurar o CA.
        config.update(
            ssl_disabled=False,
            ssl_verify_cert=ssl_verify_cert,
            ssl_verify_identity=ssl_verify_identity,
        )
        if ssl_ca:
            config["ssl_ca"] = ssl_ca
    return mysql.connector.connect(**config)


@contextmanager
def connection():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()
