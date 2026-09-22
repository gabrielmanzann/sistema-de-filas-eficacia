# 📊 Sistema de Fila de Auditoria & Gestão de Produtividade

Sistema web full-stack desenvolvido para otimizar o fluxo de atendimento da equipe de Eficácia e auditoria, garantindo distribuição justa de tarefas via fila circular, controle de acessos por perfil e relatórios corporativos automatizados.

---

## 🚀 Funcionalidades Principais

- **Fila Circular Inteligente:** Ao concluir uma auditoria, o colaborador é enviado automaticamente para o final da fila, mantendo o fluxo contínuo e equilibrado.
- **Controle de Acessos (RBAC):**
  - **Auditor:** Visualização da fila, status da sua vez e ação de conclusão.
  - **Gestor:** Painel com indicadores, gerenciamento de equipe (cadastro/edição/alteração de senha) e métricas.
- **Métricas em Tempo Real:** Alternância rápida de desempenho por períodos (**Hoje**, **Esta Semana**, **Este Mês**).
- **Exportação de Relatórios em Excel:**
  - Planilha estilizada no padrão corporativo (TIM / Unicom Group).
  - Logomarca integrada no cabeçalho.
  - Abas separadas com histórico detalhado e resumo consolidado de produtividade.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, JavaScript (ES6+ / Fetch API)
- **Backend:** Python 3, Flask
- **Banco de Dados:** MySQL
- **Relatórios:** OpenPyXL, Pillow
- **Segurança & Env:** Python-dotenv, Werkzeug

---

## 📋 Pré-requisitos

- Python 3.10+
- Servidor MySQL rodando localmente ou na nuvem (Aiven/Render)

---

## 🔧 Configuração e Instalação

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/gabrielmanzann/sistema-de-filas-eficacia.git
   cd sistema-de-filas-eficacia

2. **Crie o ambiente virtual:**   
python -m venv .venv
# No Windows:
.venv\Scripts\activate
# No Linux/Mac:
source .venv/bin/activate

3. **Instale dependências:**
pip install -r requirements.txt

4. **Configure as Variáveis de Ambiente**
APP_SECRET_KEY=sua_chave_secreta_aqui
DB_HOST=localhost
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_NAME=nome_do_banco

5. **Execute**

python app.py

Desenvolvido como projeto comercial de gestão interna.