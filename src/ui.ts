// ── Admin UI HTML Pages ──────────────────────────────────────────────

const COLORS = {
	bg: "#1a1a2e",
	card: "#16213e",
	cardHover: "#1a2745",
	accent: "#0f3460",
	primary: "#e94560",
	primaryHover: "#ff6b81",
	text: "#eee",
	textDim: "#8892b0",
	success: "#00d26a",
	error: "#ff4757",
	border: "#233554",
	input: "#0d1b2a",
} as const;

const baseStyle = `
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${COLORS.bg}; color: ${COLORS.text}; min-height: 100vh; }
	a { color: ${COLORS.primary}; text-decoration: none; }
	button { cursor: pointer; border: none; font-family: inherit; font-size: 0.875rem; }
	input { font-family: inherit; font-size: 0.875rem; }
`;

export function loginPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLMHub — Login</title>
<style>
${baseStyle}
body { display: flex; align-items: center; justify-content: center; }
.card { background: ${COLORS.card}; border-radius: 12px; padding: 2.5rem; width: 360px; max-width: 90vw; }
h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
p.sub { color: ${COLORS.textDim}; font-size: 0.85rem; margin-bottom: 1.5rem; }
label { display: block; font-size: 0.8rem; color: ${COLORS.textDim}; margin-bottom: 0.35rem; }
input[type="password"] {
	width: 100%; padding: 0.65rem 0.75rem; border-radius: 8px; border: 1px solid ${COLORS.border};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none; margin-bottom: 1rem;
}
input[type="password"]:focus { border-color: ${COLORS.primary}; }
.btn {
	width: 100%; padding: 0.7rem; border-radius: 8px; background: ${COLORS.primary}; color: #fff; font-weight: 600;
	transition: background 0.2s;
}
.btn:hover { background: ${COLORS.primaryHover}; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.err { color: ${COLORS.error}; font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
</style>
</head>
<body>
<div class="card">
	<h1>LLMHub</h1>
	<p class="sub">Admin Console</p>
	<form id="loginForm">
		<label for="pw">Password</label>
		<input type="password" id="pw" placeholder="Enter admin password" autofocus>
		<button class="btn" type="submit">Sign In</button>
		<div class="err" id="err"></div>
	</form>
</div>
<script>
const form = document.getElementById('loginForm');
const pw = document.getElementById('pw');
const err = document.getElementById('err');
form.addEventListener('submit', async e => {
	e.preventDefault();
	err.textContent = '';
	const btn = form.querySelector('button');
	btn.disabled = true;
	try {
		const res = await fetch('/admin/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: pw.value })
		});
		const data = await res.json();
		if (res.ok) { location.href = '/admin'; }
		else { err.textContent = data.error || 'Login failed'; }
	} catch { err.textContent = 'Network error'; }
	finally { btn.disabled = false; }
});
</script>
</body></html>`;
}

export function adminPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLMHub — Admin</title>
<style>
${baseStyle}
body { padding: 1.5rem; }
.container { max-width: 960px; margin: 0 auto; margin-left: 220px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
header h1 { font-size: 1.4rem; }
header .logout { color: ${COLORS.textDim}; font-size: 0.8rem; cursor: pointer; transition: color 0.2s; }
header .logout:hover { color: ${COLORS.primary}; }

/* Sidebar Navigation */
.sidebar {
	position: fixed; left: 1.5rem; top: 1.5rem; width: 180px; background: ${COLORS.card};
	border-radius: 12px; padding: 1rem; z-index: 100; max-height: calc(100vh - 3rem);
	overflow-y: auto; border: 1px solid ${COLORS.border};
}
.sidebar h3 { font-size: 0.85rem; color: ${COLORS.textDim}; margin-bottom: 0.5rem; font-weight: 600; }
.sidebar nav { display: flex; flex-direction: column; gap: 0.25rem; }
.sidebar a {
	display: block; padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.8rem;
	color: ${COLORS.textDim}; text-decoration: none; transition: all 0.2s;
}
.sidebar a:hover { background: ${COLORS.accent}; color: ${COLORS.text}; }
.sidebar a.active { background: ${COLORS.primary}; color: #fff; }

/* Sections */
.section { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; scroll-margin-top: 1rem; }
.section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: ${COLORS.textDim}; font-weight: 500; }

/* Token row */
.token-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.token-val {
	font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem; background: ${COLORS.input};
	padding: 0.5rem 0.75rem; border-radius: 6px; border: 1px solid ${COLORS.border}; flex: 1; min-width: 0;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${COLORS.text};
}
.btn-sm {
	padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.8rem; font-weight: 500;
	transition: background 0.2s, opacity 0.2s;
}
.btn-primary { background: ${COLORS.primary}; color: #fff; }
.btn-primary:hover { background: ${COLORS.primaryHover}; }
.btn-outline { background: transparent; color: ${COLORS.textDim}; border: 1px solid ${COLORS.border}; }
.btn-outline:hover { border-color: ${COLORS.textDim}; color: ${COLORS.text}; }
.btn-danger { background: transparent; color: ${COLORS.error}; border: 1px solid ${COLORS.error}33; }
.btn-danger:hover { background: ${COLORS.error}18; }
.btn-success { background: transparent; color: ${COLORS.success}; border: 1px solid ${COLORS.success}33; }
.btn-success:hover { background: ${COLORS.success}18; }
.btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

/* Password change */
.pw-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: end; }
.pw-form .field { display: flex; flex-direction: column; gap: 0.25rem; }
.pw-form label { font-size: 0.75rem; color: ${COLORS.textDim}; }
.pw-form input {
	padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid ${COLORS.border};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none; width: 180px;
}
.pw-form input:focus { border-color: ${COLORS.primary}; }
.msg { font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
.msg.ok { color: ${COLORS.success}; }
.msg.fail { color: ${COLORS.error}; }

/* Provider cards */
.provider-card { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; scroll-margin-top: 1rem; }
.provider-card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; text-transform: capitalize; }
.add-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: end; margin-bottom: 0.75rem; }
.add-form .field { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 140px; }
.add-form label { font-size: 0.75rem; color: ${COLORS.textDim}; }
.add-form input {
	padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid ${COLORS.border};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none; width: 100%;
}
.add-form input:focus { border-color: ${COLORS.primary}; }

/* Endpoint list */
.ep-list { display: flex; flex-direction: column; gap: 0.4rem; }
.ep-row {
	display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.65rem; border-radius: 8px;
	background: ${COLORS.input}; border: 1px solid ${COLORS.border}; flex-wrap: wrap;
}
.ep-row .mono { font-family: 'SF Mono','Fira Code',monospace; font-size: 0.78rem; color: ${COLORS.textDim}; }
.ep-row .url { flex: 1; min-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-row .key { width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-row input[type="checkbox"] { accent-color: ${COLORS.primary}; width: 16px; height: 16px; cursor: pointer; }
.ep-row .actions { display: flex; gap: 0.35rem; margin-left: auto; flex-shrink: 0; }
.test-indicator { font-size: 0.75rem; min-width: 60px; text-align: center; }
.test-indicator.ok { color: ${COLORS.success}; }
.test-indicator.fail { color: ${COLORS.error}; }
.test-indicator.loading { color: ${COLORS.textDim}; }

.batch-bar { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
.no-ep { color: ${COLORS.textDim}; font-size: 0.8rem; font-style: italic; padding: 0.5rem 0; }

/* Responsive */
@media (max-width: 900px) {
	.sidebar { display: none; }
	.container { margin-left: auto; }
}
@media (max-width: 600px) {
	body { padding: 0.75rem; }
	.pw-form input { width: 140px; }
}

/* Inline edit */
.ep-row .edit-input {
	font-family: 'SF Mono','Fira Code',monospace; font-size: 0.78rem;
	padding: 0.3rem 0.5rem; border-radius: 4px; border: 1px solid ${COLORS.primary};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none;
}
.ep-row .edit-url { flex: 1; min-width: 100px; }
.ep-row .edit-key { width: 160px; }

/* Logs Section */
.logs-section { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; scroll-margin-top: 1rem; }
.logs-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: ${COLORS.textDim}; font-weight: 500; }
.logs-controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }
.logs-controls select {
	padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid ${COLORS.border};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none; font-family: inherit; font-size: 0.875rem;
	cursor: pointer;
}
.logs-controls select:focus { border-color: ${COLORS.primary}; }
.logs-controls .auto-refresh {
	display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: ${COLORS.textDim};
}
.logs-controls input[type="checkbox"] { accent-color: ${COLORS.primary}; width: 16px; height: 16px; cursor: pointer; }
.log-list { display: flex; flex-direction: column; gap: 0.3rem; max-height: 300px; overflow-y: auto; margin-bottom: 0.75rem; }
.log-item {
	padding: 0.4rem 0.65rem; border-radius: 6px; background: ${COLORS.input}; border: 1px solid ${COLORS.border};
	font-family: 'SF Mono','Fira Code',monospace; font-size: 0.75rem; color: ${COLORS.textDim};
	cursor: pointer; transition: all 0.2s;
}
.log-item:hover { border-color: ${COLORS.primary}; color: ${COLORS.text}; }
.log-item.selected { border-color: ${COLORS.primary}; background: ${COLORS.accent}; color: ${COLORS.text}; }
.log-item .req { color: ${COLORS.success}; }
.log-item .res { color: ${COLORS.primary}; }
.log-viewer {
	background: ${COLORS.input}; border: 1px solid ${COLORS.border}; border-radius: 8px;
	padding: 0.75rem; max-height: 500px; overflow: auto; position: relative;
}
.log-viewer pre {
	margin: 0; font-family: 'SF Mono','Fira Code',monospace; font-size: 0.75rem;
	color: ${COLORS.text}; white-space: pre-wrap; word-break: break-all; line-height: 1.5;
}
.log-viewer-header {
	display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;
	padding-bottom: 0.5rem; border-bottom: 1px solid ${COLORS.border};
}
.log-viewer-title { font-size: 0.8rem; color: ${COLORS.textDim}; font-family: 'SF Mono','Fira Code',monospace; }
.log-viewer-actions { display: flex; gap: 0.35rem; }
.log-empty { color: ${COLORS.textDim}; font-size: 0.8rem; font-style: italic; text-align: center; padding: 1rem; }
.log-pair-view { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 768px) {
	.log-pair-view { grid-template-columns: 1fr; }
}

/* Fullscreen Log Viewer */
.log-fullscreen {
	display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000;
	background: ${COLORS.bg}; overflow: auto; padding: 1.5rem;
}
.log-fullscreen.active { display: block; }
.log-fullscreen .log-viewer {
	max-height: none; height: calc(100vh - 5rem); background: ${COLORS.card};
}
.log-fullscreen .log-viewer-header {
	position: sticky; top: 0; background: ${COLORS.card}; z-index: 10;
	padding-top: 0.5rem; margin-top: -0.5rem;
}
.log-fullscreen .log-pair-view { height: calc(100% - 3rem); overflow: auto; }
.log-fullscreen .log-pair-view > div { height: 100%; overflow: auto; }
.fullscreen-hint {
	position: absolute; top: 1rem; right: 1rem; font-size: 0.7rem; color: ${COLORS.textDim};
	background: ${COLORS.accent}; padding: 0.25rem 0.5rem; border-radius: 4px;
	border: 1px solid ${COLORS.border};
}

/* Quick Commands */
.cmd-section { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; scroll-margin-top: 1rem; }
.cmd-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: ${COLORS.textDim}; font-weight: 500; }
.cmd-group { margin-bottom: 1rem; }
.cmd-group:last-child { margin-bottom: 0; }
.cmd-group h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; text-transform: capitalize; }
.cmd-block { position: relative; margin-bottom: 0.5rem; }
.cmd-label { font-size: 0.75rem; color: ${COLORS.textDim}; margin-bottom: 0.2rem; }
.cmd-text {
	font-family: 'SF Mono','Fira Code',monospace; font-size: 0.75rem; background: ${COLORS.input};
	padding: 0.5rem 4.5rem 0.5rem 0.75rem; border-radius: 6px; border: 1px solid ${COLORS.border};
	color: ${COLORS.textDim}; word-break: break-all; white-space: pre-wrap; line-height: 1.5;
}
.cmd-copy {
	position: absolute; bottom: 0.4rem; right: 0.4rem;
	padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 500;
	background: ${COLORS.accent}; color: ${COLORS.textDim}; border: 1px solid ${COLORS.border};
	cursor: pointer; transition: all 0.2s;
}
.cmd-copy:hover { color: ${COLORS.text}; border-color: ${COLORS.textDim}; }

/* Strategy selector */
.strategy-row {
	display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;
	padding-bottom: 0.75rem; border-bottom: 1px solid ${COLORS.border};
}
.strategy-label { font-size: 0.8rem; color: ${COLORS.textDim}; font-weight: 500; }
.strategy-select {
	padding: 0.35rem 0.55rem; border-radius: 6px; border: 1px solid ${COLORS.border};
	background: ${COLORS.input}; color: ${COLORS.text}; outline: none; font-family: inherit;
	font-size: 0.8rem; cursor: pointer;
}
.strategy-select:focus { border-color: ${COLORS.primary}; }
.strategy-hint { font-size: 0.75rem; color: ${COLORS.textDim}; font-style: italic; }
.ep-weight-cell { min-width: 36px; text-align: center; font-size: 0.75rem; color: ${COLORS.primary}; }
.edit-weight { width: 60px !important; }
.weight-field { max-width: 70px; }
.hidden { display: none !important; }

/* Cmd popup in endpoint rows */
.cmd-popup-wrap { position: relative; display: inline-block; }
.cmd-popup {
	display: none; position: absolute; right: 0; top: 100%; margin-top: 4px;
	background: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 6px;
	padding: 0.35rem; z-index: 10; min-width: 120px;
	box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.cmd-popup.show { display: block; }
.cmd-popup-item {
	display: block; width: 100%; text-align: left; padding: 0.35rem 0.5rem;
	border-radius: 4px; font-size: 0.75rem; color: ${COLORS.textDim};
	background: transparent; border: none; cursor: pointer; white-space: nowrap;
	font-family: inherit;
}
.cmd-popup-item:hover { background: ${COLORS.accent}; color: ${COLORS.text}; }
</style>
</head>
<body>
<!-- Sidebar Navigation -->
<div class="sidebar">
	<h3>Navigation</h3>
	<nav>
		<a href="#token">Access Token</a>
		<a href="#password">Password</a>
		<a href="#anthropic">Anthropic</a>
		<a href="#openai">OpenAI</a>
		<a href="#gemini">Gemini</a>
		<a href="#grok">Grok</a>
		<a href="#logs">Logs</a>
		<a href="#commands">Commands</a>
	</nav>
</div>

<div class="container">
	<header>
		<h1>LLMHub Admin</h1>
		<span class="logout" id="logout">Logout</span>
	</header>

	<!-- Token Section -->
	<div class="section" id="token">
		<h2>Access Token</h2>
		<div class="token-row">
			<span class="token-val" id="tokenVal">Loading...</span>
			<button class="btn-sm btn-outline" id="copyToken">Copy</button>
			<button class="btn-sm btn-primary" id="genToken">Generate New</button>
		</div>
	</div>

	<!-- Password Section -->
	<div class="section" id="password">
		<h2>Change Admin Password</h2>
		<form class="pw-form" id="pwForm">
			<div class="field">
				<label>Current Password</label>
				<input type="password" id="curPw" required>
			</div>
			<div class="field">
				<label>New Password</label>
				<input type="password" id="newPw" required>
			</div>
			<button class="btn-sm btn-primary" type="submit">Update</button>
		</form>
		<div class="msg" id="pwMsg"></div>
	</div>

	<!-- Provider Cards -->
	<div id="providers"></div>

	<!-- Logs Section -->
	<div class="logs-section" id="logs">
		<h2>Request/Response Logs</h2>
		<div class="logs-controls">
			<select id="logFolder">
				<option value="">Select time period...</option>
			</select>
			<button class="btn-sm btn-primary" id="refreshLogs">Refresh</button>
			<label class="auto-refresh">
				<input type="checkbox" id="autoRefresh">
				<span>Auto-refresh (5s)</span>
			</label>
			<button class="btn-sm btn-outline" id="browseAll">Browse All</button>
		</div>
		<div class="log-list" id="logList"></div>
		<div class="log-viewer" id="logViewer">
			<div class="log-empty">Select a log file to view</div>
		</div>
	</div>

	<!-- Quick Commands -->
	<div id="quickCmds"></div>
</div>

<!-- Fullscreen Log Viewer -->
<div class="log-fullscreen" id="logFullscreen">
	<div class="fullscreen-hint">Press ESC to exit fullscreen</div>
	<div class="log-viewer" id="logViewerFullscreen">
		<div class="log-empty">No log selected</div>
	</div>
</div>

<script>
const API = '/admin/api';

// ── Helpers ─────────────────────────────────
async function api(path, opts = {}) {
	const res = await fetch(API + path, {
		headers: { 'Content-Type': 'application/json', ...opts.headers },
		...opts,
	});
	if (res.status === 401 && !path.includes('login')) { location.href = '/admin/login'; return null; }
	return res;
}

function mask(s, show = 6) {
	if (!s) return '';
	if (s.length <= show) return s;
	return s.slice(0, show) + '\u2022'.repeat(Math.min(s.length - show, 20));
}

document.addEventListener('click', () => {
	document.querySelectorAll('.cmd-popup.show').forEach(p => p.classList.remove('show'));
});

// ── Session check ───────────────────────────
(async () => {
	const r = await api('/session');
	if (!r || !r.ok) { location.href = '/admin/login'; return; }
	init();
})();

async function init() {
	await loadToken();
	await loadProviders();
	await loadLogFolders();
	renderQuickCommands();
}

// ── Token ───────────────────────────────────
const tokenVal = document.getElementById('tokenVal');
const copyBtn = document.getElementById('copyToken');
const genBtn = document.getElementById('genToken');

async function loadToken() {
	const r = await api('/token');
	if (!r) return;
	const d = await r.json();
	tokenVal.textContent = d.token || '(not set)';
}

copyBtn.addEventListener('click', () => {
	const t = tokenVal.textContent;
	if (!t || t === '(not set)') return;
	navigator.clipboard.writeText(t).then(() => {
		copyBtn.textContent = 'Copied!';
		setTimeout(() => copyBtn.textContent = 'Copy', 1500);
	});
});

genBtn.addEventListener('click', async () => {
	if (!confirm('Generate a new access token? Existing clients will need the new token.')) return;
	genBtn.disabled = true;
	const r = await api('/token', { method: 'POST' });
	if (r) { const d = await r.json(); tokenVal.textContent = d.token; }
	genBtn.disabled = false;
	renderQuickCommands();
});

// ── Password ────────────────────────────────
const pwForm = document.getElementById('pwForm');
const pwMsg = document.getElementById('pwMsg');

pwForm.addEventListener('submit', async e => {
	e.preventDefault();
	pwMsg.textContent = '';
	pwMsg.className = 'msg';
	const cur = document.getElementById('curPw').value;
	const np = document.getElementById('newPw').value;
	if (np.length < 4) { pwMsg.textContent = 'New password too short'; pwMsg.classList.add('fail'); return; }
	const r = await api('/change-password', { method: 'POST', body: JSON.stringify({ current: cur, newPassword: np }) });
	if (!r) return;
	const d = await r.json();
	if (r.ok) { pwMsg.textContent = 'Password updated'; pwMsg.classList.add('ok'); pwForm.reset(); }
	else { pwMsg.textContent = d.error || 'Failed'; pwMsg.classList.add('fail'); }
});

// ── Providers ───────────────────────────────
let providerData = {};
let providerStrategy = {};

async function loadProviders() {
	const r = await api('/providers');
	if (!r) return;
	const d = await r.json();
	providerData = {};
	providerStrategy = {};
	for (const [name, cfg] of Object.entries(d.providers)) {
		providerData[name] = cfg ? cfg.endpoints : [];
		providerStrategy[name] = cfg ? (cfg.strategy || 'failover-on-error') : 'failover-on-error';
	}
	renderProviders();
}

function renderProviders() {
	const c = document.getElementById('providers');
	c.innerHTML = '';
	for (const name of ['anthropic','openai','gemini','grok']) {
		c.appendChild(buildCard(name, providerData[name] || []));
	}
}

function buildCard(name, endpoints) {
	const card = document.createElement('div');
	card.className = 'provider-card';
	card.id = name;
	const currentStrategy = providerStrategy[name] || 'failover-on-error';
	const strategies = [
		['failover-on-error', 'Failover on Error'],
		['round-robin', 'Round Robin'],
		['random', 'Random'],
		['failover', 'Failover (Priority)'],
		['weighted', 'Weighted Random'],
	];
	const strategyOpts = strategies.map(([v, l]) =>
		'<option value="' + v + '"' + (v === currentStrategy ? ' selected' : '') + '>' + l + '</option>'
	).join('');

	card.innerHTML = '<h2>' + name + '</h2>'
		+ '<div class="strategy-row">'
		+ '  <label class="strategy-label">Strategy</label>'
		+ '  <select class="strategy-select" data-strategy>' + strategyOpts + '</select>'
		+ '  <span class="strategy-hint" data-hint></span>'
		+ '</div>'
		+ '<div class="add-form">'
		+ '  <div class="field"><label>Base URL</label><input type="url" placeholder="https://..." data-url></div>'
		+ '  <div class="field"><label>API Key</label><input type="text" placeholder="sk-..." data-key></div>'
		+ '  <div class="field weight-field' + (currentStrategy !== 'weighted' ? ' hidden' : '') + '"><label>Weight</label><input type="number" min="1" max="100" value="1" data-weight></div>'
		+ '  <button class="btn-sm btn-primary add-btn">Add</button>'
		+ '</div>'
		+ '<div class="ep-list" data-list></div>'
		+ '<div class="batch-bar">'
		+ '  <button class="btn-sm btn-success batch-btn">Test All</button>'
		+ '  <span class="test-indicator batch-result" data-batch></span>'
		+ '</div>';

	const hints = {
		'failover-on-error': 'Sticks with current endpoint; auto-switches on error (5xx/429/network)',
		'round-robin': 'Cycles through endpoints in order',
		'random': 'Picks a random endpoint each request',
		'failover': 'Always uses the first enabled endpoint; others are backup',
		'weighted': 'Random selection weighted by each endpoint\\'s weight value',
	};
	const hintEl = card.querySelector('[data-hint]');
	hintEl.textContent = hints[currentStrategy] || '';

	// Strategy change
	const strategySelect = card.querySelector('[data-strategy]');
	strategySelect.addEventListener('change', () => {
		const val = strategySelect.value;
		providerStrategy[name] = val;
		hintEl.textContent = hints[val] || '';
		// Toggle weight column
		card.querySelector('.weight-field')?.classList.toggle('hidden', val !== 'weighted');
		card.querySelectorAll('.ep-weight-cell').forEach(el => el.classList.toggle('hidden', val !== 'weighted'));
		saveProvider(name);
	});

	// Add button
	card.querySelector('.add-btn').addEventListener('click', () => {
		const url = card.querySelector('[data-url]').value.trim();
		const key = card.querySelector('[data-key]').value.trim();
		const weight = parseInt(card.querySelector('[data-weight]')?.value) || 1;
		if (!url || !key) return;
		providerData[name] = providerData[name] || [];
		providerData[name].push({ baseUrl: url, apiKey: key, enabled: true, weight: Math.max(1, weight) });
		card.querySelector('[data-url]').value = '';
		card.querySelector('[data-key]').value = '';
		if (card.querySelector('[data-weight]')) card.querySelector('[data-weight]').value = '1';
		saveProvider(name);
	});

	// Batch test
	card.querySelector('.batch-btn').addEventListener('click', () => batchTest(name, card));

	renderEndpoints(name, card, endpoints);
	return card;
}

function renderEndpoints(name, card, endpoints) {
	const list = card.querySelector('[data-list]');
	list.innerHTML = '';
	if (!endpoints.length) { list.innerHTML = '<div class="no-ep">No endpoints configured</div>'; return; }
	const isWeighted = providerStrategy[name] === 'weighted';

	endpoints.forEach((ep, i) => {
		const row = document.createElement('div');
		row.className = 'ep-row';
		row.innerHTML =
			'<input type="checkbox"' + (ep.enabled ? ' checked' : '') + ' data-toggle>'
			+ '<span class="mono url" title="' + esc(ep.baseUrl) + '">' + esc(mask(ep.baseUrl, 30)) + '</span>'
			+ '<span class="mono key" title="API Key">' + esc(mask(ep.apiKey, 8)) + '</span>'
			+ '<span class="ep-weight-cell mono' + (isWeighted ? '' : ' hidden') + '" title="Weight">w:' + (ep.weight || 1) + '</span>'
			+ '<span class="test-indicator" data-ti></span>'
			+ '<div class="actions">'
			+ '  <button class="btn-sm btn-success test-one">Test</button>'
			+ '  <div class="cmd-popup-wrap"><button class="btn-sm btn-outline cmd-row-btn">Cmd</button><div class="cmd-popup"><button class="cmd-popup-item" data-platform="mac">Mac / Linux</button><button class="cmd-popup-item" data-platform="win">Windows</button></div></div>'
			+ '  <button class="btn-sm btn-outline edit-btn">Edit</button>'
			+ '  <button class="btn-sm btn-danger del-btn">&times;</button>'
			+ '</div>';

		row.querySelector('[data-toggle]').addEventListener('change', e => {
			providerData[name][i].enabled = e.target.checked;
			saveProvider(name);
		});
		row.querySelector('.del-btn').addEventListener('click', () => {
			if (!confirm('Delete this endpoint?')) return;
			providerData[name].splice(i, 1);
			saveProvider(name);
		});
		row.querySelector('.test-one').addEventListener('click', () => testOne(name, ep, row.querySelector('[data-ti]')));

		const cmdRowBtn = row.querySelector('.cmd-row-btn');
		const cmdPopup = row.querySelector('.cmd-popup');
		cmdRowBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			document.querySelectorAll('.cmd-popup.show').forEach(p => p.classList.remove('show'));
			cmdPopup.classList.toggle('show');
		});
		row.querySelectorAll('.cmd-popup-item').forEach(item => {
			item.addEventListener('click', () => {
				const cmd = item.dataset.platform === 'mac'
					? 'export ANTHROPIC_AUTH_TOKEN=' + ep.apiKey + ' && export ANTHROPIC_BASE_URL=' + ep.baseUrl + ' && claude --dangerously-skip-permissions'
					: 'set ANTHROPIC_AUTH_TOKEN=' + ep.apiKey + ' & set ANTHROPIC_BASE_URL=' + ep.baseUrl + ' & claude --dangerously-skip-permissions';
				navigator.clipboard.writeText(cmd).then(() => {
					cmdRowBtn.textContent = 'Copied!';
					cmdPopup.classList.remove('show');
					setTimeout(() => cmdRowBtn.textContent = 'Cmd', 1500);
				});
			});
		});

		row.querySelector('.edit-btn').addEventListener('click', () => {
			const urlSpan = row.querySelector('.url');
			const keySpan = row.querySelector('.key');
			const weightSpan = row.querySelector('.ep-weight-cell');
			const actionsDiv = row.querySelector('.actions');

			const urlInput = document.createElement('input');
			urlInput.type = 'text';
			urlInput.className = 'edit-input edit-url';
			urlInput.value = ep.baseUrl;
			urlSpan.replaceWith(urlInput);

			const keyInput = document.createElement('input');
			keyInput.type = 'text';
			keyInput.className = 'edit-input edit-key';
			keyInput.value = ep.apiKey;
			keySpan.replaceWith(keyInput);

			if (weightSpan) {
				const weightInput = document.createElement('input');
				weightInput.type = 'number';
				weightInput.min = '1';
				weightInput.max = '100';
				weightInput.className = 'edit-input edit-weight' + (isWeighted ? '' : ' hidden');
				weightInput.value = String(ep.weight || 1);
				weightSpan.replaceWith(weightInput);
			}

			actionsDiv.innerHTML =
				'<button class="btn-sm btn-primary save-btn">Save</button>'
				+ '<button class="btn-sm btn-outline cancel-btn">Cancel</button>';

			actionsDiv.querySelector('.save-btn').addEventListener('click', () => {
				const newUrl = urlInput.value.trim();
				const newKey = keyInput.value.trim();
				if (!newUrl || !newKey) return;
				providerData[name][i].baseUrl = newUrl;
				providerData[name][i].apiKey = newKey;
				const wInput = row.querySelector('.edit-weight');
				if (wInput) providerData[name][i].weight = Math.max(1, parseInt(wInput.value) || 1);
				saveProvider(name);
			});

			actionsDiv.querySelector('.cancel-btn').addEventListener('click', () => {
				renderEndpoints(name, card, providerData[name] || []);
			});
		});

		list.appendChild(row);
	});
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function saveProvider(name) {
	await api('/providers/' + name, {
		method: 'POST',
		body: JSON.stringify({ endpoints: providerData[name] || [], strategy: providerStrategy[name] || 'failover-on-error' }),
	});
	renderProviders();
}

async function testOne(provider, ep, indicator) {
	indicator.textContent = '...';
	indicator.className = 'test-indicator loading';
	const start = performance.now();
	try {
		const r = await api('/test', {
			method: 'POST',
			body: JSON.stringify({ provider, baseUrl: ep.baseUrl, apiKey: ep.apiKey }),
		});
		const ms = Math.round(performance.now() - start);
		if (!r) return;
		const d = await r.json();
		if (r.ok && d.success !== false) { indicator.textContent = ms + 'ms'; indicator.className = 'test-indicator ok'; }
		else { indicator.textContent = d.error || 'fail'; indicator.className = 'test-indicator fail'; indicator.title = d.error || ''; }
	} catch {
		indicator.textContent = 'error';
		indicator.className = 'test-indicator fail';
	}
}

async function batchTest(name, card) {
	const eps = providerData[name] || [];
	if (!eps.length) return;
	const indicators = card.querySelectorAll('[data-ti]');
	const batchResult = card.querySelector('[data-batch]');
	batchResult.textContent = 'testing...';
	batchResult.className = 'test-indicator loading';

	let ok = 0, fail = 0;
	const promises = eps.map((ep, i) => testOne(name, ep, indicators[i]).then(() => {
		if (indicators[i].classList.contains('ok')) ok++; else fail++;
	}));
	await Promise.all(promises);
	batchResult.textContent = ok + '/' + eps.length + ' passed';
	batchResult.className = 'test-indicator ' + (fail === 0 ? 'ok' : 'fail');
}

// ── Quick Commands ──────────────────────────
function renderQuickCommands() {
	const container = document.getElementById('quickCmds');
	const token = tokenVal.textContent;
	if (!token || token === '(not set)' || token === 'Loading...') { container.innerHTML = ''; return; }
	const origin = location.origin;
	const providers = ['anthropic', 'openai', 'gemini', 'grok'];

	let html = '<div class="cmd-section" id="commands"><h2>Quick Run Commands</h2>';
	providers.forEach(name => {
		const base = origin + '/' + name;
		const macCmd = 'export ANTHROPIC_AUTH_TOKEN=' + token + ' && export ANTHROPIC_BASE_URL=' + base + ' && claude --dangerously-skip-permissions';
		const winCmd = 'set ANTHROPIC_AUTH_TOKEN=' + token + ' & set ANTHROPIC_BASE_URL=' + base + ' & claude --dangerously-skip-permissions';
		html += '<div class="cmd-group"><h3>' + esc(name) + '</h3>'
			+ '<div class="cmd-block"><div class="cmd-label">Mac / Linux</div><div class="cmd-text">' + esc(macCmd) + '</div><button class="cmd-copy">Copy</button></div>'
			+ '<div class="cmd-block"><div class="cmd-label">Windows</div><div class="cmd-text">' + esc(winCmd) + '</div><button class="cmd-copy">Copy</button></div>'
			+ '</div>';
	});
	html += '</div>';
	container.innerHTML = html;

	container.querySelectorAll('.cmd-copy').forEach(btn => {
		btn.addEventListener('click', () => {
			const text = btn.previousElementSibling.textContent;
			navigator.clipboard.writeText(text).then(() => {
				btn.textContent = 'Copied!';
				setTimeout(() => btn.textContent = 'Copy', 1500);
			});
		});
	});
}

// ── Logout ──────────────────────────────────
document.getElementById('logout').addEventListener('click', () => {
	document.cookie = 'session=; Path=/; Max-Age=0';
	location.href = '/admin/login';
});

// ── Sidebar Navigation ──────────────────────
const navLinks = document.querySelectorAll('.sidebar a');
const navIds = Array.from(navLinks).map(l => l.getAttribute('href').slice(1));

// Smooth scroll + update hash
navLinks.forEach(link => {
	link.addEventListener('click', (e) => {
		e.preventDefault();
		const targetId = link.getAttribute('href').slice(1);
		const target = document.getElementById(targetId);
		if (target) {
			target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			history.replaceState(null, '', '#' + targetId);
			setActiveNav(targetId);
		}
	});
});

function setActiveNav(id) {
	navLinks.forEach(link => {
		link.classList.toggle('active', link.getAttribute('href') === '#' + id);
	});
}

// Update active nav on scroll — re-query sections dynamically
let scrollTimeout;
let isAutoScrolling = false;
window.addEventListener('scroll', () => {
	if (isAutoScrolling) return;
	clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => {
		let current = '';
		for (const id of navIds) {
			const el = document.getElementById(id);
			if (el && el.getBoundingClientRect().top <= 120) {
				current = id;
			}
		}
		if (current) {
			setActiveNav(current);
			history.replaceState(null, '', '#' + current);
		}
	}, 100);
});

// Handle initial hash on page load
function scrollToHash() {
	const hash = location.hash.slice(1);
	if (!hash) return;
	// Retry a few times since dynamic sections may not exist yet
	let tries = 0;
	const attempt = () => {
		const el = document.getElementById(hash);
		if (el) {
			isAutoScrolling = true;
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
			setActiveNav(hash);
			setTimeout(() => { isAutoScrolling = false; }, 800);
		} else if (tries++ < 5) {
			setTimeout(attempt, 300);
		}
	};
	attempt();
}
setTimeout(scrollToHash, 200);

// ── Logs ────────────────────────────────────
const logFolderSelect = document.getElementById('logFolder');
const logList = document.getElementById('logList');
const logViewer = document.getElementById('logViewer');
const logFullscreen = document.getElementById('logFullscreen');
const logViewerFullscreen = document.getElementById('logViewerFullscreen');
const autoRefreshCheckbox = document.getElementById('autoRefresh');
const browseAllBtn = document.getElementById('browseAll');
let currentFiles = [];
let selectedLogKey = null;
let autoRefreshInterval = null;
let currentLogIndex = 0;
let allLogs = [];
let isFullscreen = false;
let currentLogData = null;

async function loadLogFolders() {
	const r = await api('/logs');
	if (!r) return;
	const d = await r.json();
	logFolderSelect.innerHTML = '<option value="">Select time period...</option>';
	d.folders.forEach(f => {
		const opt = document.createElement('option');
		opt.value = f;
		opt.textContent = f;
		logFolderSelect.appendChild(opt);
	});
}

logFolderSelect.addEventListener('change', async () => {
	const folder = logFolderSelect.value;
	if (!folder) { logList.innerHTML = ''; logViewer.innerHTML = '<div class="log-empty">Select a time period</div>'; return; }
	
	const r = await api('/logs/' + folder);
	if (!r) return;
	const d = await r.json();
	currentFiles = d.files;
	renderLogList();
	logViewer.innerHTML = '<div class="log-empty">Select a log file to view</div>';
});

document.getElementById('refreshLogs').addEventListener('click', async () => {
	await loadLogFolders();
	if (logFolderSelect.value) {
		logFolderSelect.dispatchEvent(new Event('change'));
	}
});

// Auto-refresh
autoRefreshCheckbox.addEventListener('change', () => {
	if (autoRefreshCheckbox.checked) {
		autoRefreshInterval = setInterval(async () => {
			if (logFolderSelect.value) {
				const r = await api('/logs/' + logFolderSelect.value);
				if (r) {
					const d = await r.json();
					currentFiles = d.files;
					renderLogList();
				}
			}
		}, 5000);
	} else {
		if (autoRefreshInterval) {
			clearInterval(autoRefreshInterval);
			autoRefreshInterval = null;
		}
	}
});

// Browse all logs
browseAllBtn.addEventListener('click', async () => {
	if (!logFolderSelect.value) {
		alert('Please select a time period first');
		return;
	}
	
	// Prepare all logs
	const pairs = new Map();
	currentFiles.forEach(f => {
		const match = f.name.match(/^(.+)_(req|res)$/);
		if (match) {
			const [, id, type] = match;
			if (!pairs.has(id)) pairs.set(id, {});
			pairs.get(id)[type] = f.key;
		}
	});
	
	allLogs = Array.from(pairs.entries()).sort((a, b) => b[0].localeCompare(a[0]));
	if (allLogs.length === 0) {
		alert('No logs to browse');
		return;
	}
	
	currentLogIndex = 0;
	await showLogAtIndex(0);
});

async function showLogAtIndex(index) {
	if (index < 0 || index >= allLogs.length) return;
	
	currentLogIndex = index;
	const [id, files] = allLogs[index];
	
	// Highlight in list
	document.querySelectorAll('.log-item').forEach((item, i) => {
		item.classList.toggle('selected', i === index);
	});
	
	logViewer.innerHTML = '<div class="log-empty">Loading...</div>';
	
	const results = {};
	if (files.req) {
		const r = await api('/log-content?key=' + encodeURIComponent(files.req));
		if (r) results.req = await r.json();
	}
	if (files.res) {
		const r = await api('/log-content?key=' + encodeURIComponent(files.res));
		if (r) results.res = await r.json();
	}
	
	renderLogPairWithNav(id, results, index);
}

function renderLogList() {
	logList.innerHTML = '';
	if (!currentFiles.length) {
		logList.innerHTML = '<div class="log-empty">No logs in this period</div>';
		return;
	}

	// Group by request ID
	const pairs = new Map();
	currentFiles.forEach(f => {
		const match = f.name.match(/^(.+)_(req|res)$/);
		if (match) {
			const [, id, type] = match;
			if (!pairs.has(id)) pairs.set(id, {});
			pairs.get(id)[type] = f.key;
		}
	});

	// Render pairs
	Array.from(pairs.entries()).sort((a, b) => b[0].localeCompare(a[0])).forEach(([id, files], idx) => {
		const item = document.createElement('div');
		item.className = 'log-item';
		const hasReq = files.req ? '<span class="req">REQ</span>' : '';
		const hasRes = files.res ? '<span class="res">RES</span>' : '';
		item.innerHTML = hasReq + (hasReq && hasRes ? ' + ' : '') + hasRes + ' ' + esc(id);
		item.addEventListener('click', () => viewLogPair(id, files, idx));
		logList.appendChild(item);
	});
}

async function viewLogPair(id, files, idx) {
	document.querySelectorAll('.log-item').forEach(i => i.classList.remove('selected'));
	event.target.closest('.log-item').classList.add('selected');

	logViewer.innerHTML = '<div class="log-empty">Loading...</div>';

	const results = {};
	if (files.req) {
		const r = await api('/log-content?key=' + encodeURIComponent(files.req));
		if (r) results.req = await r.json();
	}
	if (files.res) {
		const r = await api('/log-content?key=' + encodeURIComponent(files.res));
		if (r) results.res = await r.json();
	}

	renderLogPair(id, results);
}

function renderLogPair(id, results) {
	currentLogData = { id, results }; // Store for fullscreen
	
	let html = '<div class="log-viewer-header">'
		+ '<div class="log-viewer-title">' + esc(id) + '</div>'
		+ '<div class="log-viewer-actions">'
		+ '  <button class="btn-sm btn-outline fullscreen-btn">⛶ Fullscreen</button>'
		+ '  <button class="btn-sm btn-outline copy-log">Copy All</button>'
		+ '</div>'
		+ '</div>';

	if (results.req || results.res) {
		html += '<div class="log-pair-view">';
		
		if (results.req) {
			html += '<div><div style="color: #00d26a; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">REQUEST</div>'
				+ '<pre>' + esc(results.req.content ? JSON.stringify(results.req.content, null, 2) : results.req.raw) + '</pre></div>';
		}
		
		if (results.res) {
			html += '<div><div style="color: #e94560; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">RESPONSE</div>'
				+ '<pre>' + esc(results.res.content ? JSON.stringify(results.res.content, null, 2) : results.res.raw) + '</pre></div>';
		}
		
		html += '</div>';
	} else {
		html += '<div class="log-empty">No data</div>';
	}

	logViewer.innerHTML = html;

	logViewer.querySelector('.fullscreen-btn')?.addEventListener('click', () => openFullscreen());
	
	logViewer.querySelector('.copy-log')?.addEventListener('click', () => {
		const text = JSON.stringify({ request: results.req?.content || results.req?.raw, response: results.res?.content || results.res?.raw }, null, 2);
		navigator.clipboard.writeText(text).then(() => {
			const btn = logViewer.querySelector('.copy-log');
			btn.textContent = 'Copied!';
			setTimeout(() => btn.textContent = 'Copy All', 1500);
		});
	});
}

function renderLogPairWithNav(id, results, index) {
	currentLogData = { id, results, index }; // Store for fullscreen
	
	let html = '<div class="log-viewer-header">'
		+ '<div class="log-viewer-title">' + esc(id) + ' (' + (index + 1) + '/' + allLogs.length + ')</div>'
		+ '<div class="log-viewer-actions">'
		+ '  <button class="btn-sm btn-outline" id="prevLog" ' + (index === 0 ? 'disabled' : '') + '>← Prev</button>'
		+ '  <button class="btn-sm btn-outline" id="nextLog" ' + (index === allLogs.length - 1 ? 'disabled' : '') + '>Next →</button>'
		+ '  <button class="btn-sm btn-outline fullscreen-btn">⛶ Fullscreen</button>'
		+ '  <button class="btn-sm btn-outline copy-log">Copy All</button>'
		+ '</div>'
		+ '</div>';

	if (results.req || results.res) {
		html += '<div class="log-pair-view">';
		
		if (results.req) {
			html += '<div><div style="color: #00d26a; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">REQUEST</div>'
				+ '<pre>' + esc(results.req.content ? JSON.stringify(results.req.content, null, 2) : results.req.raw) + '</pre></div>';
		}
		
		if (results.res) {
			html += '<div><div style="color: #e94560; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">RESPONSE</div>'
				+ '<pre>' + esc(results.res.content ? JSON.stringify(results.res.content, null, 2) : results.res.raw) + '</pre></div>';
		}
		
		html += '</div>';
	} else {
		html += '<div class="log-empty">No data</div>';
	}

	logViewer.innerHTML = html;

	// Navigation buttons
	document.getElementById('prevLog')?.addEventListener('click', () => showLogAtIndex(currentLogIndex - 1));
	document.getElementById('nextLog')?.addEventListener('click', () => showLogAtIndex(currentLogIndex + 1));
	
	logViewer.querySelector('.fullscreen-btn')?.addEventListener('click', () => openFullscreen());

	logViewer.querySelector('.copy-log')?.addEventListener('click', () => {
		const text = JSON.stringify({ request: results.req?.content || results.req?.raw, response: results.res?.content || results.res?.raw }, null, 2);
		navigator.clipboard.writeText(text).then(() => {
			const btn = logViewer.querySelector('.copy-log');
			btn.textContent = 'Copied!';
			setTimeout(() => btn.textContent = 'Copy All', 1500);
		});
	});
}

// Fullscreen functions
function openFullscreen() {
	if (!currentLogData) return;
	
	isFullscreen = true;
	logFullscreen.classList.add('active');
	document.body.style.overflow = 'hidden';
	
	renderFullscreenLog(currentLogData.id, currentLogData.results, currentLogData.index);
}

function closeFullscreen() {
	isFullscreen = false;
	logFullscreen.classList.remove('active');
	document.body.style.overflow = '';
}

function renderFullscreenLog(id, results, index) {
	const hasNav = typeof index === 'number';
	
	let html = '<div class="log-viewer-header">'
		+ '<div class="log-viewer-title">' + esc(id) + (hasNav ? ' (' + (index + 1) + '/' + allLogs.length + ')' : '') + '</div>'
		+ '<div class="log-viewer-actions">';
	
	if (hasNav) {
		html += '<button class="btn-sm btn-outline" id="prevLogFs" ' + (index === 0 ? 'disabled' : '') + '>← Prev</button>'
			+ '<button class="btn-sm btn-outline" id="nextLogFs" ' + (index === allLogs.length - 1 ? 'disabled' : '') + '>Next →</button>';
	}
	
	html += '  <button class="btn-sm btn-outline copy-log-fs">Copy All</button>'
		+ '  <button class="btn-sm btn-danger close-fs">✕ Close</button>'
		+ '</div>'
		+ '</div>';

	if (results.req || results.res) {
		html += '<div class="log-pair-view">';
		
		if (results.req) {
			html += '<div><div style="color: #00d26a; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">REQUEST</div>'
				+ '<pre>' + esc(results.req.content ? JSON.stringify(results.req.content, null, 2) : results.req.raw) + '</pre></div>';
		}
		
		if (results.res) {
			html += '<div><div style="color: #e94560; font-size: 0.75rem; margin-bottom: 0.35rem; font-weight: 600;">RESPONSE</div>'
				+ '<pre>' + esc(results.res.content ? JSON.stringify(results.res.content, null, 2) : results.res.raw) + '</pre></div>';
		}
		
		html += '</div>';
	} else {
		html += '<div class="log-empty">No data</div>';
	}

	logViewerFullscreen.innerHTML = html;

	// Event listeners
	if (hasNav) {
		document.getElementById('prevLogFs')?.addEventListener('click', () => {
			showLogAtIndex(currentLogIndex - 1);
			renderFullscreenLog(currentLogData.id, currentLogData.results, currentLogData.index);
		});
		document.getElementById('nextLogFs')?.addEventListener('click', () => {
			showLogAtIndex(currentLogIndex + 1);
			renderFullscreenLog(currentLogData.id, currentLogData.results, currentLogData.index);
		});
	}
	
	logViewerFullscreen.querySelector('.close-fs')?.addEventListener('click', closeFullscreen);
	
	logViewerFullscreen.querySelector('.copy-log-fs')?.addEventListener('click', () => {
		const text = JSON.stringify({ request: results.req?.content || results.req?.raw, response: results.res?.content || results.res?.raw }, null, 2);
		navigator.clipboard.writeText(text).then(() => {
			const btn = logViewerFullscreen.querySelector('.copy-log-fs');
			btn.textContent = 'Copied!';
			setTimeout(() => btn.textContent = 'Copy All', 1500);
		});
	});
}

function handleKeyNav(e) {
	// ESC to close fullscreen
	if (e.key === 'Escape' && isFullscreen) {
		e.preventDefault();
		closeFullscreen();
		return;
	}
	
	if (allLogs.length === 0) return;
	
	// Arrow keys for navigation (works in both normal and fullscreen)
	if (e.key === 'ArrowLeft' && currentLogIndex > 0) {
		e.preventDefault();
		showLogAtIndex(currentLogIndex - 1);
		if (isFullscreen) {
			renderFullscreenLog(currentLogData.id, currentLogData.results, currentLogData.index);
		}
	} else if (e.key === 'ArrowRight' && currentLogIndex < allLogs.length - 1) {
		e.preventDefault();
		showLogAtIndex(currentLogIndex + 1);
		if (isFullscreen) {
			renderFullscreenLog(currentLogData.id, currentLogData.results, currentLogData.index);
		}
	}
}

// Register keyboard navigation globally
document.addEventListener('keydown', handleKeyNav);

</script>
</body></html>`;
}
