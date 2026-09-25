// A interface e a API Flask são servidas pelo mesmo host. Assim, no Render
// a origem vira automaticamente https://<servico>.onrender.com, sem portas.
const API_ORIGIN = window.location.origin;
const THEME_KEY = "fila-auditoria-theme";
const SESSION_KEY = "fila-auditoria-session";
const HIDDEN_METRIC_RANKING_NAMES = new Set(["ricardo", "emerson", "carla"]);

let state = {
  queue: [],
  ranking: [],
  auditRanking: [],
  metrics: { periodo: "dia", titulo: "Hoje", total_auditorias: 0, ranking: [] },
  users: [],
  inactiveUsers: [],
};
let session = loadSession();
let currentView = "login";
let editingUserId = null;
let selectedMetricPeriod = "dia";
let showInactiveProfiles = false;
let auditorRankingExpanded = false;

// A fila muda com frequência, mas métricas e cadastros não. O ciclo curto
// consulta somente a fila; os dados mais caros são atualizados com menor
// frequência ou logo depois da ação que os altera.
const POLL_INTERVAL_MS = 6000;
const MAX_POLL_INTERVAL_MS = 60000;
const METRICS_INTERVAL_MS = 30000;
const QUEUE_ACTION_SELECTOR = [
  '[data-action="complete-turn"]',
  '[data-action="clear-queue"]',
  '[data-action="remove"]',
  '[data-action="move-up"]',
  '[data-action="move-down"]',
].join(", ");

let queueRequest = null;
let metricsRequest = null;
let usersRequest = null;
let queueVersion = 0;
let pollTimer = null;
let consecutivePollFailures = 0;
let lastMetricsRefreshAt = 0;
let renderScheduled = false;
const pendingActionGroups = new Map();

const views = {
  login: document.getElementById("view-login"),
  auditor: document.getElementById("view-auditor"),
  gestor: document.getElementById("view-gestor"),
  display: document.getElementById("view-display"),
};

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function saveSession(value) {
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(SESSION_KEY);
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

function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function sameQueue(left, right) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other && item.id === other.id && item.usuario_id === other.usuario_id
      && item.nome === other.nome && item.posicao === other.posicao && item.status === other.status;
  });
}

function requestRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function updateQueue(queue) {
  if (sameQueue(state.queue, queue)) return false;
  state.queue = queue;
  queueVersion += 1;
  requestRender();
  return true;
}

function updateMetrics(metrics, auditRanking = state.auditRanking) {
  const changed = !sameValue(state.metrics, metrics) || !sameValue(state.auditRanking, auditRanking);
  if (!changed) return false;
  state.metrics = metrics;
  state.ranking = metrics.ranking;
  state.auditRanking = auditRanking;
  requestRender();
  return true;
}

function updateUsers(users, inactiveUsers) {
  if (sameValue(state.users, users) && sameValue(state.inactiveUsers, inactiveUsers)) return false;
  state.users = users;
  state.inactiveUsers = inactiveUsers;
  requestRender();
  return true;
}

async function refreshQueue() {
  if (queueRequest) return queueRequest;
  const tokenAtStart = session?.token;
  const versionAtStart = queueVersion;
  queueRequest = api("/api/fila")
    .then((result) => {
      // Uma ação do usuário concluída depois do pedido tem precedência sobre
      // uma resposta de polling que possa estar defasada.
      if (session?.token === tokenAtStart && queueVersion === versionAtStart) updateQueue(result.fila);
      return result;
    })
    .finally(() => { queueRequest = null; });
  return queueRequest;
}

async function refreshMetrics() {
  const period = isManager() ? selectedMetricPeriod : "dia";
  if (metricsRequest?.period === period) return metricsRequest.promise;

  const tokenAtStart = session?.token;
  const request = isManager()
    ? Promise.all([api(`/api/gestor/metrics?periodo=${period}`)])
    : Promise.all([api(`/api/gestor/metrics?periodo=${period}`), api("/api/ranking-auditorias")]);
  const promise = request.then(([metricsResult, auditRankingResult]) => {
    // Ao alternar o período, a resposta anterior não pode sobrescrever a aba atual.
    if (session?.token === tokenAtStart && period === (isManager() ? selectedMetricPeriod : "dia")) {
      updateMetrics(metricsResult, auditRankingResult?.ranking || []);
      lastMetricsRefreshAt = Date.now();
    }
    return metricsResult;
  }).finally(() => {
    if (metricsRequest?.promise === promise) metricsRequest = null;
  });
  metricsRequest = { period, promise };
  return promise;
}

async function refreshUsers() {
  if (!isManager()) return;
  if (usersRequest) return usersRequest;
  const tokenAtStart = session?.token;
  usersRequest = Promise.all([api("/api/usuarios"), api("/api/usuarios/desativados")])
    .then(([usersResult, inactiveUsersResult]) => {
      if (session?.token === tokenAtStart && isManager()) updateUsers(usersResult.usuarios, inactiveUsersResult.usuarios);
      return usersResult;
    })
    .finally(() => { usersRequest = null; });
  return usersRequest;
}

async function refreshState({ users = false, metrics = true, queue = true } = {}) {
  const requests = [];
  if (queue) requests.push(refreshQueue());
  if (metrics) requests.push(refreshMetrics());
  if (users && isManager()) requests.push(refreshUsers());
  await Promise.all(requests);
}

function shouldPoll() {
  return Boolean(session?.token) && !document.hidden && currentView !== "login";
}

function stopAutoRefresh() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function scheduleAutoRefresh(delay = POLL_INTERVAL_MS) {
  stopAutoRefresh();
  if (!shouldPoll()) return;
  pollTimer = window.setTimeout(runAutoRefresh, delay);
}

async function runAutoRefresh() {
  if (!shouldPoll()) return;
  try {
    await refreshQueue();
    if (currentView !== "display" && Date.now() - lastMetricsRefreshAt >= METRICS_INTERVAL_MS) await refreshMetrics();
    consecutivePollFailures = 0;
  } catch (error) {
    consecutivePollFailures += 1;
    console.warn("Não foi possível atualizar automaticamente a fila.", error);
  } finally {
    const delay = Math.min(POLL_INTERVAL_MS * (2 ** consecutivePollFailures), MAX_POLL_INTERVAL_MS);
    scheduleAutoRefresh(delay);
  }
}

function startAutoRefresh({ immediate = false } = {}) {
  if (immediate) {
    stopAutoRefresh();
    void runAutoRefresh();
  } else {
    scheduleAutoRefresh();
  }
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

function setText(elementId, value) {
  const element = document.getElementById(elementId);
  const next = String(value);
  if (element.textContent !== next) element.textContent = next;
}

function setHtml(elementId, html) {
  const element = document.getElementById(elementId);
  if (element.innerHTML !== html) element.innerHTML = html;
}

function setClassName(element, className) {
  if (element.className !== className) element.className = className;
}

function elementFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// Reconcilia uma lista por chave: respostas idênticas não escrevem no DOM e
// alterações preservam os itens que não mudaram, inclusive ao reordenar.
function reconcileKeyedList(elementId, entries, emptyHtml) {
  const container = document.getElementById(elementId);
  if (!entries.length) {
    setHtml(elementId, emptyHtml);
    return;
  }

  const existing = new Map(
    Array.from(container.children)
      .filter((child) => child.dataset.renderKey)
      .map((child) => [child.dataset.renderKey, child]),
  );
  Array.from(container.children)
    .filter((child) => !child.dataset.renderKey)
    .forEach((child) => child.remove());

  let cursor = container.firstElementChild;
  entries.forEach(({ key, html }) => {
    const renderKey = String(key);
    let child = existing.get(renderKey);
    if (!child || child.outerHTML !== html) {
      const next = elementFromHtml(html);
      if (child) {
        child.replaceWith(next);
        if (child === cursor) cursor = next;
      }
      child = next;
    }
    if (child !== cursor) container.insertBefore(child, cursor);
    cursor = child.nextElementSibling;
    existing.delete(renderKey);
  });
  existing.forEach((child) => child.remove());
}

function queueEntries(manager) {
  return state.queue.map((person, index) => ({ key: person.id, html: queueItem(person, index, manager) }));
}

function queueItem(person, index, manager) {
  const status = person.status === "EM_ANDAMENTO" ? "Realizando" : "Aguardando";
  const statusClass = index === 0 ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  const actions = manager ? `<div class="flex flex-wrap gap-1"><button type="button" data-action="move-up" data-id="${person.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Subir</button><button type="button" data-action="move-down" data-id="${person.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Descer</button><button type="button" data-action="remove" data-id="${person.id}" class="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 dark:border-rose-900">Remover</button></div>` : "";
  return `<li data-render-key="${person.id}" class="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"><div class="flex min-w-0 items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${index === 0 ? "bg-brand-500 text-white" : "bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200"} text-sm font-bold">${ordinal(index + 1)}</span><div class="min-w-0"><p class="truncate font-semibold">${escapeHtml(person.nome)}</p><span class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}">${status}</span></div></div>${actions}</li>`;
}

function renderAuditorOptimized() {
  const name = session?.nome || "";
  setText("auditor-greeting", `Ol\u00e1, ${name}`);
  const person = state.queue.find((item) => item.usuario_id === session?.id);
  const index = person ? person.posicao - 1 : -1;
  const rankingItem = state.ranking.find((item) => item.usuario_id === session?.id);
  setText("auditor-count", rankingItem?.total || 0);

  const card = document.getElementById("auditor-turn-card");
  let cardClass;
  let cardHtml;
  if (!state.queue.length) {
    cardClass = "mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
    cardHtml = "<p class=\"text-lg font-semibold\">A fila est\u00e1 vazia no momento.</p>";
  } else if (index < 0) {
    cardClass = "mb-5 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-900 dark:bg-amber-950/40";
    cardHtml = "<p class=\"text-lg font-semibold\">Voc\u00ea ainda n\u00e3o est\u00e1 na fila.</p>";
  } else if (index === 0) {
    cardClass = "mb-5 overflow-hidden rounded-xl bg-gradient-to-r from-brand-500 to-indigo-900 p-6 text-white shadow-card";
    cardHtml = "<div class=\"flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between\"><div><p class=\"text-sm font-semibold uppercase tracking-widest text-indigo-100\">Sua vez</p><p class=\"mt-1 text-2xl font-extrabold sm:text-3xl\">\u00c9 a sua vez de realizar a auditoria!</p></div><button type=\"button\" data-action=\"complete-turn\" class=\"rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-indigo-50\">Concluir e passar a vez</button></div>";
  } else {
    cardClass = "mb-5 overflow-hidden rounded-2xl border-2 border-indigo-400 bg-gradient-to-r from-indigo-700 via-indigo-600 to-blue-700 p-6 text-white shadow-card dark:border-indigo-300";
    cardHtml = `<div class="flex flex-wrap items-center gap-4"><span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black text-white ring-1 ring-white/35">${ordinal(index + 1)}</span><div><p class="text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">Sua posi\u00e7\u00e3o na fila</p><p class="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Voc\u00ea \u00e9 o ${ordinal(index + 1)} da fila</p><p class="mt-2 text-base font-medium text-indigo-50">Aguarde a sua vez na ordem da auditoria.</p></div></div>`;
  }
  setClassName(card, cardClass);
  setHtml("auditor-turn-card", cardHtml);
  reconcileKeyedList("auditor-queue", queueEntries(false), "<li class=\"text-sm text-slate-500\">Ningu\u00e9m na fila.</li>");
  renderAuditorRankingOptimized();
}

function renderAuditorRankingOptimized() {
  const toggle = document.getElementById("toggle-auditor-ranking");
  const visibleRanking = auditorRankingExpanded ? state.auditRanking : state.auditRanking.slice(0, 5);
  const entries = visibleRanking.map((item, index) => {
    const position = index + 1;
    const total = Number(item.total) || 0;
    const label = total === 1 ? "auditoria" : "auditorias";
    const currentUser = item.usuario_id === session?.id;
    return {
      key: item.usuario_id,
      html: `<li data-render-key="${item.usuario_id}" class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/70"><div class="flex min-w-0 items-center gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${position <= 3 ? "bg-brand-500 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"} text-xs font-extrabold">${ordinal(position)}</span><p class="truncate text-sm font-semibold">${escapeHtml(item.nome)}${currentUser ? " <span class=\"font-normal text-slate-500\">(voc\u00ea)</span>" : ""}</p></div><span class="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">${total} ${label}</span></li>`,
    };
  });
  reconcileKeyedList("auditor-ranking", entries, "<li class=\"rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:bg-slate-800/70\">Nenhuma auditoria conclu\u00edda ainda.</li>");
  toggle.hidden = state.auditRanking.length <= 5;
  setText("toggle-auditor-ranking", auditorRankingExpanded ? "Ver menos" : "Ver mais");
}

function renderUserSelectOptimized() {
  const queuedUserIds = new Set(state.queue.map((item) => item.usuario_id));
  const employees = state.users.filter((user) => user.tipo_usuario === "FUNCIONARIO" && user.ativo && !queuedUserIds.has(user.id));
  setHtml("add-user", `<option value="">Selecione um funcion\u00e1rio</option>${employees.map((user) => `<option value="${user.id}">${escapeHtml(user.nome)}</option>`).join("")}`);
}

function renderUsersOptimized() {
  const entries = state.users.map((user) => {
    const ownUser = user.id === session?.id;
    return {
      key: user.id,
      html: `<tr data-render-key="${user.id}" class="border-b border-slate-100 dark:border-slate-800"><td class="px-3 py-3 font-medium">${escapeHtml(user.nome)}${ownUser ? " <span class=\"text-xs font-normal text-slate-500\">(voc\u00ea)</span>" : ""}</td><td class="px-3 py-3">${user.tipo_usuario === "GESTOR" ? "Gestor" : "Funcion\u00e1rio"}</td><td class="px-3 py-3"><span class="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Ativo</span></td><td class="px-3 py-3 text-right"><div class="inline-flex flex-wrap justify-end gap-2"><button type="button" data-action="edit-user" data-user-id="${user.id}" class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">Editar / senha</button>${ownUser ? "" : `<button type="button" data-action="deactivate-user" data-user-id="${user.id}" class="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 dark:border-rose-900">Excluir (inativar)</button>`}</div></td></tr>`,
    };
  });
  reconcileKeyedList("user-list", entries, "<tr><td colspan=\"4\" class=\"px-3 py-5 text-slate-500\">Nenhum usu\u00e1rio cadastrado.</td></tr>");
  renderUserSelectOptimized();
}

function renderInactiveUsersOptimized() {
  const panel = document.getElementById("inactive-users-panel");
  const toggle = document.getElementById("toggle-inactive-users");
  if (!panel || !toggle) return;
  setText("inactive-users-count", state.inactiveUsers.length);
  panel.classList.toggle("hidden", !showInactiveProfiles);
  setText("toggle-inactive-users", showInactiveProfiles ? "Ocultar perfis" : "Ver perfis desativados");
  const entries = state.inactiveUsers.map((user) => ({
    key: user.id,
    html: `<tr data-render-key="${user.id}" class="border-b border-slate-100 dark:border-slate-800"><td class="px-3 py-3 font-medium">${escapeHtml(user.nome)}</td><td class="px-3 py-3">${user.tipo_usuario === "GESTOR" ? "Gestor" : "Funcion\u00e1rio"}</td><td class="px-3 py-3"><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Desativado</span></td><td class="px-3 py-3 text-right"><div class="inline-flex flex-wrap justify-end gap-2"><button type="button" data-action="reactivate-user" data-user-id="${user.id}" class="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Reativar</button><button type="button" data-action="delete-user-permanently" data-user-id="${user.id}" class="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40">Excluir definitivamente</button></div></td></tr>`,
  }));
  reconcileKeyedList("inactive-user-list", entries, "<tr><td colspan=\"4\" class=\"px-3 py-5 text-slate-500\">Nenhum perfil desativado.</td></tr>");
}

function renderGestorOptimized() {
  const current = state.queue[0];
  setHtml("gestor-current", current
    ? `<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-semibold uppercase tracking-widest text-indigo-100">Vez atual</p><p class="mt-1 text-3xl font-extrabold">${escapeHtml(current.nome)}</p><p class="mt-1 text-sm text-indigo-100">est\u00e1 realizando a auditoria agora.</p></div><button type="button" data-action="complete-turn" class="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-indigo-50">Concluir e passar a vez</button></div>`
    : "<p class=\"text-2xl font-extrabold\">Ningu\u00e9m na vez</p><p class=\"mt-1 text-sm text-indigo-100\">Adicione funcion\u00e1rios \u00e0 fila para iniciar.</p>");
  reconcileKeyedList("gestor-queue", queueEntries(true), "<li class=\"text-sm text-slate-500\">A fila est\u00e1 vazia.</li>");
  setText("metric-queue", state.queue.length);
  setText("metric-waiting", Math.max(state.queue.length - 1, 0));
  setText("metric-total-completed", state.metrics.total_auditorias || 0);
  setText("metric-period-label", state.metrics.titulo || "Hoje");
  const metricEntries = state.ranking
    .filter((item) => !HIDDEN_METRIC_RANKING_NAMES.has((item.nome || "").trim().toLocaleLowerCase("pt-BR")))
    .map((item, index) => ({
      key: item.usuario_id,
      html: `<li data-render-key="${item.usuario_id}" class="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/70"><span class="font-semibold">${ordinal(index + 1)} ${escapeHtml(item.nome)}</span><span class="text-sm text-slate-500">${item.total} auditorias</span></li>`,
    }));
  reconcileKeyedList("metrics-rank", metricEntries, "<li class=\"text-sm text-slate-500\">Nenhuma auditoria encontrada no per\u00edodo.</li>");
  document.querySelectorAll("[data-metric-period]").forEach((button) => {
    const isSelected = button.dataset.metricPeriod === selectedMetricPeriod;
    button.classList.toggle("bg-brand-500", isSelected);
    button.classList.toggle("text-white", isSelected);
    button.classList.toggle("border-brand-500", isSelected);
    button.classList.toggle("bg-white", !isSelected);
    button.classList.toggle("dark:bg-slate-800", !isSelected);
  });
  renderUsersOptimized();
  renderInactiveUsersOptimized();
}

function renderDisplayOptimized() {
  const current = state.queue[0];
  setHtml("display-current", current
    ? `<p class="text-lg font-semibold uppercase tracking-[0.2em] text-indigo-100">Vez atual</p><p class="mt-2 text-5xl font-extrabold sm:text-7xl">${escapeHtml(current.nome)}</p><p class="mt-3 text-xl text-indigo-100">Realizando a auditoria</p>`
    : "<p class=\"text-4xl font-extrabold\">Fila vazia</p>");
  const entries = state.queue.map((item, index) => ({
    key: item.id,
    html: `<li data-render-key="${item.id}" class="rounded-xl border border-white/10 bg-white/5 px-5 py-4"><p class="text-sm text-brand-300">${ordinal(index + 1)} \u00b7 ${index === 0 ? "Realizando" : "Aguardando"}</p><p class="mt-1 text-2xl font-bold">${escapeHtml(item.nome)}</p></li>`,
  }));
  reconcileKeyedList("display-queue", entries, "");
}

function render() {
  if (currentView === "auditor") renderAuditorOptimized();
  if (currentView === "gestor") renderGestorOptimized();
  if (currentView === "display") renderDisplayOptimized();
  syncPendingActionButtons();
}

function setButtonPending(button, pending) {
  button.disabled = pending;
  button.classList.toggle("opacity-60", pending);
  button.classList.toggle("cursor-wait", pending);
  if (pending) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function setActionGroupPending(selector, pending) {
  if (!selector) return;
  document.querySelectorAll(selector).forEach((button) => setButtonPending(button, pending));
}

function syncPendingActionButtons() {
  pendingActionGroups.forEach((selector) => setActionGroupPending(selector, true));
}

async function withActionLock(button, key, task, selector = null) {
  if (pendingActionGroups.has(key) || button.disabled) return;
  pendingActionGroups.set(key, selector);
  setButtonPending(button, true);
  setActionGroupPending(selector, true);
  try {
    return await task();
  } finally {
    pendingActionGroups.delete(key);
    setActionGroupPending(selector, false);
    // O botão pode ter sido substituído por uma atualização do DOM.
    if (button.isConnected) setButtonPending(button, false);
  }
}

async function refreshAfter(action, { metrics = false, users = false } = {}) {
  try {
    const result = await action();
    if (Array.isArray(result?.fila)) updateQueue(result.fila);
    else await refreshQueue();
    if (metrics) await refreshMetrics();
    if (users) await refreshUsers();
    return result;
  } catch (error) {
    notifyError(error);
    return null;
  }
}

async function permanentlyDeleteInactiveUser(userId) {
  const result = await api(`/api/usuarios/${userId}/permanente`, { method: "DELETE" });
  updateUsers(state.users, state.inactiveUsers.filter((user) => user.id !== userId));
  refreshQueue().catch(notifyError);
  refreshMetrics().catch(notifyError);
  return result;
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

async function logout() {
  stopAutoRefresh();
  try {
    if (session?.token) await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    notifyError(error);
  } finally {
    session = null;
    auditorRankingExpanded = false;
    saveSession(null);
    showView("login");
  }
}

function notifyQueueExitOnPageHide(event) {
  if (event.persisted || !session?.token || isManager()) return;
  const payload = JSON.stringify({ token: session.token });
  const endpoint = `${API_ORIGIN}/api/logout`;
  const beaconBody = new Blob([payload], { type: "application/json" });
  if (navigator.sendBeacon?.(endpoint, beaconBody)) return;
  fetch(endpoint, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("login-error");
  const submitButton = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  await withActionLock(submitButton, "login", async () => {
    try {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify({ nome: document.getElementById("login-user").value.trim(), senha: document.getElementById("login-pass").value }) });
      session = { ...result.usuario, token: result.token };
      auditorRankingExpanded = false;
      saveSession(session);
      error.classList.add("hidden");
      await refreshState({ users: isManager() });
      showView(isManager() ? "gestor" : "auditor");
      startAutoRefresh();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
    }
  });
});

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = Number(document.getElementById("add-user").value);
  if (!userId) return;
  const submitButton = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  await withActionLock(
    submitButton,
    "queue-mutation",
    () => refreshAfter(() => api("/api/fila/adicionar", { method: "POST", body: JSON.stringify({ usuario_id: userId }) })),
    QUEUE_ACTION_SELECTOR,
  );
});

document.getElementById("user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("user-name").value.trim();
  const password = document.getElementById("user-password").value;
  const type = document.getElementById("user-type").value;
  const message = document.getElementById("user-form-message");
  const submitButton = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  await withActionLock(submitButton, "user-form", async () => {
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
    await refreshState({ users: true, metrics: false });
    resetUserForm();
    } catch (error) { message.textContent = error.message; }
  });
});

document.getElementById("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("password-error");
  const submitButton = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  await withActionLock(submitButton, "change-password", async () => {
    try {
      await api("/api/minha-senha", { method: "PATCH", body: JSON.stringify({ senha_atual: document.getElementById("current-password").value, nova_senha: document.getElementById("new-password").value }) });
      closePasswordDialog();
      alert("Senha alterada com sucesso.");
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
    }
  });
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "toggle-theme") return toggleTheme();
  if (action === "logout") return withActionLock(button, "logout", logout);
  if (action === "open-password") return openPasswordDialog();
  if (action === "close-password") return closePasswordDialog();
  if (action === "open-display") return showView("display");
  if (action === "close-display") {
    showView("gestor");
    return startAutoRefresh({ immediate: true });
  }
  if (action === "cancel-user-edit") return resetUserForm();
  if (action === "select-metric-period") {
    const period = button.dataset.metricPeriod;
    if (!["dia", "semana", "mes"].includes(period) || period === selectedMetricPeriod) return;
    selectedMetricPeriod = period;
    return refreshMetrics().catch(notifyError);
  }
  if (action === "export-excel") return withActionLock(button, "export-excel", () => downloadExcelReport().catch(notifyError));
  if (action === "reset-audit-metrics") {
    const confirmed = confirm("Zerar todas as auditorias concluídas? Esta ação é irreversível e afeta os rankings, a semana e o mês.");
    if (!confirmed) return;
    return withActionLock(button, "reset-audit-metrics", async () => {
      try {
      const result = await api("/api/gestor/metricas/resetar", {
        method: "POST",
        body: JSON.stringify({ confirmar: true }),
      });
      await refreshMetrics();
      alert(`${result.auditorias_removidas} auditoria(s) removida(s). Métricas zeradas.`);
      } catch (error) {
        notifyError(error);
      }
    });
  }
  if (action === "toggle-auditor-ranking") {
    auditorRankingExpanded = !auditorRankingExpanded;
    return renderAuditorRankingOptimized();
  }
  if (action === "edit-user") return startUserEdit(Number(button.dataset.userId));
  if (action === "toggle-inactive-users") {
    showInactiveProfiles = !showInactiveProfiles;
    return renderInactiveUsersOptimized();
  }
  if (action === "reactivate-user") {
    const target = state.inactiveUsers.find((user) => user.id === Number(button.dataset.userId));
    if (target && confirm(`Reativar o perfil de ${target.nome}?`)) {
      return withActionLock(button, "user-status", () => refreshAfter(() => api(`/api/usuarios/${target.id}/reativar`, { method: "POST", body: JSON.stringify({}) }), { users: true }), '[data-action="reactivate-user"], [data-action="deactivate-user"]');
    }
    return;
  }
  if (action === "delete-user-permanently") {
    const target = state.inactiveUsers.find((user) => user.id === Number(button.dataset.userId));
    if (target && confirm("Tem certeza que deseja excluir permanentemente este perfil? Esta ação não pode ser desfeita.")) {
      return withActionLock(button, "permanent-user-deletion", () => permanentlyDeleteInactiveUser(target.id), '[data-action="reactivate-user"], [data-action="delete-user-permanently"]');
    }
    return;
  }
  if (action === "deactivate-user") {
    const target = state.users.find((user) => user.id === Number(button.dataset.userId));
    if (target && confirm(`Inativar ${target.nome}? O acesso e a participação na fila serão removidos.`)) {
      return withActionLock(button, "user-status", () => refreshAfter(() => api(`/api/usuarios/${target.id}`, { method: "DELETE" }), { users: true }), '[data-action="reactivate-user"], [data-action="deactivate-user"]');
    }
    return;
  }
  if (action === "complete-turn") return withActionLock(button, "queue-mutation", () => refreshAfter(() => api("/api/fila/concluir", { method: "POST", body: JSON.stringify({}) }), { metrics: true }), QUEUE_ACTION_SELECTOR);
  if (action === "clear-queue" && confirm("Limpar toda a fila?")) return withActionLock(button, "queue-mutation", () => refreshAfter(() => api("/api/fila/limpar", { method: "POST", body: JSON.stringify({}) })), QUEUE_ACTION_SELECTOR);
  if (action === "remove") return withActionLock(button, "queue-mutation", () => refreshAfter(() => api("/api/fila/remover", { method: "POST", body: JSON.stringify({ id: Number(button.dataset.id) }) })), QUEUE_ACTION_SELECTOR);
  if (action === "move-up" || action === "move-down") return withActionLock(button, "queue-mutation", () => refreshAfter(() => api("/api/fila/reordenar", { method: "POST", body: JSON.stringify({ id: Number(button.dataset.id), acao: action === "move-up" ? "SUBIR" : "DESCER" }) })), QUEUE_ACTION_SELECTOR);
});

applyTheme();
if (session?.token) {
  showView(isManager() ? "gestor" : "auditor");
  (async () => {
    try {
      // Um reload dispara pagehide. A entrada idempotente mantém a mesma
      // sessão na fila sem criar uma duplicata.
      if (!isManager()) {
        const joinedQueue = await api("/api/fila/entrar", { method: "POST", body: JSON.stringify({}) });
        updateQueue(joinedQueue.fila);
      }
      await refreshState({ users: isManager(), queue: isManager() });
      startAutoRefresh();
    } catch {
      session = null;
      saveSession(null);
      showView("login");
    }
  })();
} else {
  session = null;
  saveSession(null);
  showView("login");
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
    return;
  }
  startAutoRefresh({ immediate: true });
});

window.addEventListener("pagehide", (event) => {
  stopAutoRefresh();
  notifyQueueExitOnPageHide(event);
});
