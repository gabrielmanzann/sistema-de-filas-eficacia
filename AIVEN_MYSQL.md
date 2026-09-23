# Conexao com Aiven for MySQL

O projeto usa `mysql-connector-python` e carrega o `.env` com
`python-dotenv`. No painel do Aiven, em **Connection information**, copie os
valores para o arquivo `.env` local (que nao deve ser enviado ao Git):

```dotenv
DB_HOST=<host-do-aiven>
DB_PORT=<porta-do-aiven>
DB_USER=<usuario-do-aiven>
DB_PASSWORD=<senha-do-aiven>
DB_NAME=<nome-do-banco>
DB_SSL_ENABLED=true
DB_SSL_VERIFY_CERT=false
```

Com essa configuracao a conexao usa TLS, mas nao falha por falta do certificado
CA local. Para producao, baixe o **CA Certificate** na pagina Overview do
servico Aiven e altere para:

```dotenv
DB_SSL_CA=C:/caminho/seguro/ca.pem
DB_SSL_VERIFY_CERT=true
DB_SSL_VERIFY_IDENTITY=true
```

Teste sem exibir credenciais:

```sh
python -c "from db import get_connection; conn = get_connection(); conn.close(); print('Conexao com MySQL realizada.')"
```

O endpoint `GET /api/health` tambem responde `{"status":"ok"}` quando a
aplicacao consegue acessar o banco.
