# Sistema de Fila de Auditoria da Área de Eficácia

Aplicação web com Flask, MySQL e JavaScript puro para controlar a fila de auditorias e os usuários do sistema.

## O que foi corrigido

O contrato de autenticação agora é único: o front-end envia `nome` e `senha` em JSON para `POST /api/login`; a API devolve sempre JSON, inclusive em erros. O cliente envia `Content-Type: application/json` sempre que há corpo e transmite o token retornado no cabeçalho `Authorization: Bearer <token>` nas demais chamadas.

O CORS foi limitado às origens locais configuradas em `CORS_ORIGINS` e libera explicitamente os cabeçalhos `Content-Type` e `Authorization`. Assim, uma falha de conexão, origem não permitida ou resposta que não seja JSON passa a exibir uma mensagem clara na tela, em vez de um erro genérico de `fetch`.

## Banco de dados

O modelo de usuário é:

| Campo | Finalidade |
| --- | --- |
| `id` | Identificador do usuário |
| `nome` | Login simples e único |
| `senha` | Hash da senha; nunca é retornado pela API |
| `tipo_usuario` | `GESTOR` ou `FUNCIONARIO` |
| `ativo` | Permite inativar sem apagar o histórico |

### Instalação nova

1. Copie `.env.example` para `.env` e informe as credenciais do MySQL. Mantenha `DB_NAME=fila_auditoria_eficacia`.
2. Defina uma chave longa e aleatória em `APP_SECRET_KEY`.
3. Execute o conteúdo de `schema.sql` no MySQL Workbench ou use:

```powershell
Get-Content -Raw schema.sql | mysql -u root -p
```

O script cria somente o banco `fila_auditoria_eficacia`, as tabelas e quatro usuários de demonstração.

### Base da versão anterior

Antes de migrar, faça backup. Execute `migration.sql` no banco antigo, depois aponte `DB_NAME` para esse banco. O e-mail antigo pode permanecer na tabela, mas não é utilizado pelo sistema novo.

Os hashes SHA-256 dos usuários de demonstração continuam sendo aceitos uma única vez; no login seguinte, a API os substitui automaticamente por hashes do Werkzeug.

## Executar

```powershell
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py app.py
```

Em outro terminal, sirva os arquivos estáticos:

```powershell
npx --yes serve .
```

Abra o endereço informado pelo servidor estático, normalmente `http://localhost:3000`. A API é iniciada em `http://127.0.0.1:5000`.

Para diagnosticar a infraestrutura antes de efetuar login, abra `http://127.0.0.1:5000/api/health`. A resposta deve ser `{"status":"ok"}`. Se ela retornar `503`, revise as credenciais, a porta do MySQL e a existência do banco.

## Acesso de demonstração

Todos os usuários abaixo usam a senha `123`:

| Nome | Perfil |
| --- | --- |
| Agata, Ricardo, Maria | Funcionário |
| Gestor | Gestor |

## Rotas

| Método | Rota | Acesso | Corpo JSON |
| --- | --- | --- | --- |
| `POST` | `/api/login` | Público | `{"nome":"Agata","senha":"123"}` |
| `PATCH` | `/api/minha-senha` | Usuário autenticado | `{"senha_atual":"123","nova_senha":"nova"}` |
| `GET` | `/api/usuarios` | Gestor | — |
| `POST` | `/api/usuarios` | Gestor | `{"nome":"Ana","senha":"123","tipo_usuario":"FUNCIONARIO"}` |
| `PATCH` | `/api/usuarios/<id>` | Gestor | Nome, senha, perfil e/ou `ativo` |
| `DELETE` | `/api/usuarios/<id>` | Gestor | —; inativa o usuário |
| `GET` | `/api/gestor/metrics?periodo=dia\|semana\|mes` | Autenticado | Retorna total e ranking do período |
| `GET` | `/api/gestor/exportar-excel?periodo=dia\|semana\|mes` | Gestor | Baixa o relatório `.xlsx` |

Ao concluir uma auditoria, o funcionário permanece na fila e é reenfileirado na última posição. O próximo funcionário passa a ficar em `EM_ANDAMENTO`; se houver somente uma pessoa, ela continua em andamento por ser a única da fila.

## Painel do gestor

O painel inclui:

- cadastro de funcionário ou gestor com nome, senha inicial e perfil;
- tabela de usuários com edição de nome/perfil, redefinição de senha e inativação;
- seletor de funcionários ativos para adicionar à fila;
- botão de alteração da própria senha, disponível a gestores e funcionários.
- tabs de métricas para hoje, últimos 7 dias e mês atual;
- relatório Excel com histórico, ranking, cores TIM e logomarca Unicom Group em `assets/logo-unicomgroup.png`.

Para hospedar o front-end em outra porta/origem, ajuste a meta `api-base` em `index.html` e inclua exatamente a mesma origem em `CORS_ORIGINS` no `.env` antes de reiniciar o Flask.
