// A interface e a API Flask são servidas pelo mesmo host. Assim, no Render
// a origem vira automaticamente https://<servico>.onrender.com, sem portas.
const API_ORIGIN = window.location.origin;
const THEME_KEY = "fila-auditoria-theme";
const SESSION_KEY = "fila-auditoria-session";

let state = {
  queue: [],
  ranking: [],
  metrics: { periodo: "dia", titulo: "Hoje", total_auditorias: 0, ranking: [] },
  users: [],
};
let session = loadSession();
let currentView = "login";
let editingUserId = null;
let selectedMetricPeriod = "dia";

const views = {
  login: document.getElementById("view-login"),
  auditor: document.getElementById("view-auditor"),
  gestor: document.getElementById("view-gestor"),
  display: document.getElementById("view-display"),
};

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function saveSession(value) {
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

async function api(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (session?.token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${session.token}`);

  const requestUrl = `${API_ORIGIN}${endpoint}`;
  let response;
  try {
    response = await fetch(requestUrl, { ...options, headers });
  } catch {
    throw new Error(`Não foi possível conectar à API em ${requestUrl}. Confirme que a aplicação está online.`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.error("A API retornou uma resposta não JSON.", {
      endpoint: requestUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
    });
    throw new Error(`A API retornou HTTP ${response.status} em formato não JSON. Confira o console do navegador.`);
  }

  let body;
  try { body = await response.json(); }
  catch {
    console.error("Não foi possível interpretar o JSON da API.", { endpoint: requestUrl, status: response.status });
    throw new Error(`A API retornou HTTP ${response.status} com JSON inválido.`);
  }
  if (!response.ok) throw new Error(body.erro || "Não foi possível concluir a operação.");
  return body;
}

function notifyError(error) { alert(error.message || "Ocorreu um erro inesperado."); }
function ordinal(value) { return `${value}º`; }

function applyTheme(theme) {
  const next = theme || localStorage.getItem(THEME_KEY) || "dark";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.classList.toggle("dark", next === "dark");
}

function toggleTheme() { applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"); }

function isManager() { return session?.tipo_usuario === "GESTOR"; }

async function refreshState() {
  const period = isManager() ? selectedMetricPeriod : "dia";
  const requests = [api("/api/fila"), api(`/api/gestor/metrics?periodo=${period}`)];
  if (isManager()) requests.push(api("/api/usuarios"));
  const [queueResult, metricsResult, usersResult] = await Promise.all(requests);
  state.queue = queueResult.fila;
  state.metrics = metricsResult;
  state.ranking = metricsResult.ranking;
  state.users = usersResult?.usuarios || [];
  render();
}

async function downloadExcelReport() {
  const headers = new Headers();
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  let response;
  try {
    response = await fetch(`${API_ORIGIN}/api/gestor/exportar-excel?periodo=${selectedMetricPeriod}`, { headers });
  } catch {
    throw new Error("Não foi possível conectar à API para baixar o relatório.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.erro || "Não foi possível gerar o relatório Excel.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-auditorias-${selectedMetricPeriod}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showView(name) {
  currentView = name;
  Object.entries(views).forEach(([key, element]) => element.classList.toggle("is-active", key === name));
  render();
}

function queueItem(person, index, manager) {
  const status = person.status === "EM_ANDAMENTO" ? "Realizando" : "Aguardando";
  const statusClass = index === 0 ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  const actions = manager ? `<div class="flex flex-wrap gap-1"><button type="button" data-action="move-up" data-id="${person.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Subir</button><button type="button" data-action="move-down" data-id="${person.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Descer</button><button type="button" data-action="remove" data-id="${person.id}" class="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 dark:border-rose-900">Remover</button></div>` : "";
  return `<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"><div class="flex min-w-0 items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${index === 0 ? "bg-brand-500 text-white" : "bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200"} text-sm font-bold">${ordinal(index + 1)}</span><div class="min-w-0"><p class="truncate font-semibold">${escapeHtml(person.nome)}</p><span class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}">${status}</span></div></div>${actions}</li>`;
}

function renderAuditor() {
  const name = session?.nome || "";
  document.getElementById("auditor-greeting").textContent = `Olá, ${name}`;
  const person = state.queue.find((item) => item.usuario_id === session.id);
  const index = person ? person.posicao - 1 : -1;
  const rankingItem = state.ranking.find((item) => item.usuario_id === session.id);
  document.getElementById("auditor-count").textContent = String(rankingItem?.total || 0);
  const card = document.getElementById("auditor-turn-card");
  if (!state.queue.length) {
    card.className = "mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
    card.innerHTML = "<p class=\"text-lg font-semibold\">A fila está vazia no momento.</p>";
  } else if (index < 0) {
    card.className = "mb-5 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-900 dark:bg-amber-950/40";
    card.innerHTML = "<p class=\"text-lg font-semibold\">Você ainda não está na fila.</p>";
  } else if (index === 0) {
    card.className = "mb-5 overflow-hidden rounded-xl bg-gradient-to-r from-brand-500 to-indigo-900 p-6 text-white shadow-card";
    card.innerHTML = "<div class=\"flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between\"><div><p class=\"text-sm font-semibold uppercase tracking-widest text-indigo-100\">Sua vez</p><p class=\"mt-1 text-2xl font-extrabold sm:text-3xl\">É a sua vez de realizar a auditoria!</p></div><button type=\"button\" data-action=\"complete-turn\" class=\"rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-indigo-50\">Concluir e passar a vez</button></div>";
  } else {
    card.className = "mb-5 overflow-hidden rounded-2xl border-2 border-indigo-400 bg-gradient-to-r from-indigo-700 via-indigo-600 to-blue-700 p-6 text-white shadow-card dark:border-indigo-300";
    card.innerHTML = `<div class="flex flex-wrap items-center gap-4"><span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black text-white ring-1 ring-white/35">${ordinal(index + 1)}</span><div><p class="text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">Sua posição na fila</p><p class="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Você é o ${ordinal(index + 1)} da fila</p><p class="mt-2 text-base font-medium text-indigo-50">Aguarde a sua vez na ordem da auditoria.</p></div></div>`;
  }
  document.getElementById("auditor-queue").innerHTML = state.queue.length ? state.queue.map((item, index) => queueItem(item, index, false)).join("") : "<li class=\"text-sm text-slate-500\">Ninguém na fila.</li>";
}

function renderUserSelect() {
  const select = document.getElementById("add-user");
  const queuedUserIds = new Set(state.queue.map((item) => item.usuario_id));
  const employees = state.users.filter((user) => user.tipo_usuario === "FUNCIONARIO" && user.ativo && !queuedUserIds.has(user.id));
  select.innerHTML = `<option value="">Selecione um funcionário</option>${employees.map((user) => `<option value="${user.id}">${escapeHtml(user.nome)}</option>`).join("")}`;
}

function renderUsers() {
  const list = document.getElementById("user-list");
  list.innerHTML = state.users.length ? state.users.map((user) => {
    const ownUser = user.id === session.id;
    return `<tr class="border-b border-slate-100 dark:border-slate-800"><td class="px-3 py-3 font-medium">${escapeHtml(user.nome)}${ownUser ? " <span class=\"text-xs font-normal text-slate-500\">(você)</span>" : ""}</td><td class="px-3 py-3">${user.tipo_usuario === "GESTOR" ? "Gestor" : "Funcionário"}</td><td class="px-3 py-3"><span class="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Ativo</span></td><td class="px-3 py-3 text-right"><div class="inline-flex flex-wrap justify-end gap-2"><button type="button" data-action="edit-user" data-user-id="${user.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Editar / senha</button>${ownUser ? "" : `<button type="button" data-action="deactivate-user" data-user-id="${user.id}" class="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 dark:border-rose-900">Excluir (inativar)</button>`}</div></td></tr>`;
  }).join("") : "<tr><td colspan=\"4\" class=\"px-3 py-5 text-slate-500\">Nenhum usuário cadastrado.</td></tr>";
  renderUserSelect();
}

function renderGestor() {
  const current = state.queue[0];
  document.getElementById("gestor-current").innerHTML = current ? `<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-semibold uppercase tracking-widest text-indigo-100">Vez atual</p><p class="mt-1 text-3xl font-extrabold">${escapeHtml(current.nome)}</p><p class="mt-1 text-sm text-indigo-100">está realizando a auditoria agora.</p></div><button type="button" data-action="complete-turn" class="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-indigo-50">Concluir e passar a vez</button></div>` : "<p class=\"text-2xl font-extrabold\">Ninguém na vez</p><p class=\"mt-1 text-sm text-indigo-100\">Adicione funcionários à fila para iniciar.</p>";
  document.getElementById("gestor-queue").innerHTML = state.queue.length ? state.queue.map((item, index) => queueItem(item, index, true)).join("") : "<li class=\"text-sm text-slate-500\">A fila está vazia.</li>";
  document.getElementById("metric-queue").textContent = state.queue.length;
  document.getElementById("metric-waiting").textContent = Math.max(state.queue.length - 1, 0);
  document.getElementById("metric-total-completed").textContent = state.metrics.total_auditorias || 0;
  document.getElementById("metric-period-label").textContent = state.metrics.titulo || "Hoje";
  document.getElementById("metrics-rank").innerHTML = state.ranking.length ? state.ranking.map((item, index) => `<li class="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/70"><span class="font-semibold">${ordinal(index + 1)} ${escapeHtml(item.nome)}</span><span class="text-sm text-slate-500">${item.total} auditorias</span></li>`).join("") : "<li class=\"text-sm text-slate-500\">Nenhuma auditoria encontrada no período.</li>";
  document.querySelectorAll("[data-metric-period]").forEach((button) => {
    const isSelected = button.dataset.metricPeriod === selectedMetricPeriod;
    button.classList.toggle("bg-brand-500", isSelected);
    button.classList.toggle("text-white", isSelected);
    button.classList.toggle("border-brand-500", isSelected);
    button.classList.toggle("bg-white", !isSelected);
    button.classList.toggle("dark:bg-slate-800", !isSelected);
  });
  renderUsers();
}

function renderDisplay() {
  const current = state.queue[0];
  document.getElementById("display-current").innerHTML = current ? `<p class="text-lg font-semibold uppercase tracking-[0.2em] text-indigo-100">Vez atual</p><p class="mt-2 text-5xl font-extrabold sm:text-7xl">${escapeHtml(current.nome)}</p><p class="mt-3 text-xl text-indigo-100">Realizando a auditoria</p>` : "<p class=\"text-4xl font-extrabold\">Fila vazia</p>";
  document.getElementById("display-queue").innerHTML = state.queue.map((item, index) => `<li class="rounded-xl border border-white/10 bg-white/5 px-5 py-4"><p class="text-sm text-brand-300">${ordinal(index + 1)} · ${index === 0 ? "Realizando" : "Aguardando"}</p><p class="mt-1 text-2xl font-bold">${escapeHtml(item.nome)}</p></li>`).join("");
}

function render() {
  if (currentView === "auditor") renderAuditor();
  if (currentView === "gestor") renderGestor();
  if (currentView === "display") renderDisplay();
}

async function refreshAfter(action) {
  try { await action(); await refreshState(); }
  catch (error) { notifyError(error); }
}

function resetUserForm() {
  editingUserId = null;
  document.getElementById("user-form").reset();
  document.getElementById("user-password").required = true;
  document.getElementById("password-hint").textContent = "inicial";
  document.getElementById("user-submit").textContent = "Cadastrar usuário";
  document.getElementById("cancel-user-edit").classList.add("hidden");
  document.getElementById("user-form-message").textContent = "";
}

function startUserEdit(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  editingUserId = user.id;
  document.getElementById("user-name").value = user.nome;
  document.getElementById("user-password").value = "";
  document.getElementById("user-password").required = false;
  document.getElementById("user-type").value = user.tipo_usuario;
  document.getElementById("password-hint").textContent = "(deixe em branco para manter)";
  document.getElementById("user-submit").textContent = "Salvar alterações";
  document.getElementById("cancel-user-edit").classList.remove("hidden");
  document.getElementById("user-name").focus();
}

function openPasswordDialog() {
  document.getElementById("password-form").reset();
  document.getElementById("password-error").classList.add("hidden");
  document.getElementById("password-dialog").classList.remove("hidden");
  document.getElementById("password-dialog").classList.add("flex");
  document.getElementById("current-password").focus();
}

function closePasswordDialog() {
  document.getElementById("password-dialog").classList.add("hidden");
  document.getElementById("password-dialog").classList.remove("flex");
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("login-error");
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ nome: document.getElementById("login-user").value.trim(), senha: document.getElementById("login-pass").value }) });
    session = { ...result.usuario, token: result.token };
    saveSession(session);
    error.classList.add("hidden");
    await refreshState();
    showView(isManager() ? "gestor" : "auditor");
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = Number(document.getElementById("add-user").value);
  if (!userId) return;
  await refreshAfter(() => api("/api/fila/adicionar", { method: "POST", body: JSON.stringify({ usuario_id: userId }) }));
});

document.getElementById("user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("user-name").value.trim();
  const password = document.getElementById("user-password").value;
  const type = document.getElementById("user-type").value;
  const message = document.getElementById("user-form-message");
  try {
    if (editingUserId) {
      const payload = { nome: name, tipo_usuario: type };
      if (password) payload.senha = password;
      await api(`/api/usuarios/${editingUserId}`, { method: "PATCH", body: JSON.stringify(payload) });
      message.textContent = "Usuário atualizado.";
    } else {
      await api("/api/usuarios", { method: "POST", body: JSON.stringify({ nome: name, senha: password, tipo_usuario: type }) });
      message.textContent = "Usuário cadastrado.";
    }
    await refreshState();
    resetUserForm();
  } catch (error) { message.textContent = error.message; }
});

document.getElementById("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("password-error");
  try {
    await api("/api/minha-senha", { method: "PATCH", body: JSON.stringify({ senha_atual: document.getElementById("current-password").value, nova_senha: document.getElementById("new-password").value }) });
    closePasswordDialog();
    alert("Senha alterada com sucesso.");
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "toggle-theme") return toggleTheme();
  if (action === "logout") { session = null; saveSession(null); return showView("login"); }
  if (action === "open-password") return openPasswordDialog();
  if (action === "close-password") return closePasswordDialog();
  if (action === "open-display") return showView("display");
  if (action === "close-display") return showView("gestor");
  if (action === "cancel-user-edit") return resetUserForm();
  if (action === "select-metric-period") {
    const period = button.dataset.metricPeriod;
    if (!["dia", "semana", "mes"].includes(period) || period === selectedMetricPeriod) return;
    selectedMetricPeriod = period;
    return refreshState().catch(notifyError);
  }
  if (action === "export-excel") return downloadExcelReport().catch(notifyError);
  if (action === "edit-user") return startUserEdit(Number(button.dataset.userId));
  if (action === "deactivate-user") {
    const target = state.users.find((user) => user.id === Number(button.dataset.userId));
    if (target && confirm(`Inativar ${target.nome}? O acesso e a participação na fila serão removidos.`)) {
      return refreshAfter(() => api(`/api/usuarios/${target.id}`, { method: "DELETE" }));
    }
    return;
  }
  if (action === "complete-turn") return refreshAfter(() => api("/api/fila/concluir", { method: "POST", body: JSON.stringify({}) }));
  if (action === "clear-queue" && confirm("Limpar toda a fila?")) return refreshAfter(() => api("/api/fila/limpar", { method: "POST", body: JSON.stringify({}) }));
  if (action === "remove") return refreshAfter(() => api("/api/fila/remover", { method: "POST", body: JSON.stringify({ id: Number(button.dataset.id) }) }));
  if (action === "move-up" || action === "move-down") return refreshAfter(() => api("/api/fila/reordenar", { method: "POST", body: JSON.stringify({ id: Number(button.dataset.id), acao: action === "move-up" ? "SUBIR" : "DESCER" }) }));
});

applyTheme();
if (session?.token) {
  showView(isManager() ? "gestor" : "auditor");
  refreshState().catch(() => { session = null; saveSession(null); showView("login"); });
} else {
  session = null;
  saveSession(null);
  showView("login");
}
