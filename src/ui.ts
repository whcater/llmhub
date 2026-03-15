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
.container { max-width: 960px; margin: 0 auto; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
header h1 { font-size: 1.4rem; }
header .logout { color: ${COLORS.textDim}; font-size: 0.8rem; cursor: pointer; transition: color 0.2s; }
header .logout:hover { color: ${COLORS.primary}; }

/* Sections */
.section { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
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
.provider-card { background: ${COLORS.card}; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
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
@media (max-width: 600px) {
	body { padding: 0.75rem; }
	.pw-form input { width: 140px; }
}
</style>
</head>
<body>
<div class="container">
	<header>
		<h1>LLMHub Admin</h1>
		<span class="logout" id="logout">Logout</span>
	</header>

	<!-- Token Section -->
	<div class="section">
		<h2>Access Token</h2>
		<div class="token-row">
			<span class="token-val" id="tokenVal">Loading...</span>
			<button class="btn-sm btn-outline" id="copyToken">Copy</button>
			<button class="btn-sm btn-primary" id="genToken">Generate New</button>
		</div>
	</div>

	<!-- Password Section -->
	<div class="section">
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

// ── Session check ───────────────────────────
(async () => {
	const r = await api('/session');
	if (!r || !r.ok) { location.href = '/admin/login'; return; }
	init();
})();

async function init() {
	await loadToken();
	await loadProviders();
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

async function loadProviders() {
	const r = await api('/providers');
	if (!r) return;
	const d = await r.json();
	providerData = {};
	for (const [name, cfg] of Object.entries(d.providers)) {
		providerData[name] = cfg ? cfg.endpoints : [];
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
	card.innerHTML = '<h2>' + name + '</h2>'
		+ '<div class="add-form">'
		+ '  <div class="field"><label>Base URL</label><input type="url" placeholder="https://..." data-url></div>'
		+ '  <div class="field"><label>API Key</label><input type="text" placeholder="sk-..." data-key></div>'
		+ '  <button class="btn-sm btn-primary add-btn">Add</button>'
		+ '</div>'
		+ '<div class="ep-list" data-list></div>'
		+ '<div class="batch-bar">'
		+ '  <button class="btn-sm btn-success batch-btn">Test All</button>'
		+ '  <span class="test-indicator batch-result" data-batch></span>'
		+ '</div>';

	// Add button
	card.querySelector('.add-btn').addEventListener('click', () => {
		const url = card.querySelector('[data-url]').value.trim();
		const key = card.querySelector('[data-key]').value.trim();
		if (!url || !key) return;
		providerData[name] = providerData[name] || [];
		providerData[name].push({ baseUrl: url, apiKey: key, enabled: true });
		card.querySelector('[data-url]').value = '';
		card.querySelector('[data-key]').value = '';
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

	endpoints.forEach((ep, i) => {
		const row = document.createElement('div');
		row.className = 'ep-row';
		row.innerHTML =
			'<input type="checkbox"' + (ep.enabled ? ' checked' : '') + ' data-toggle>'
			+ '<span class="mono url" title="' + esc(ep.baseUrl) + '">' + esc(mask(ep.baseUrl, 30)) + '</span>'
			+ '<span class="mono key" title="API Key">' + esc(mask(ep.apiKey, 8)) + '</span>'
			+ '<span class="test-indicator" data-ti></span>'
			+ '<div class="actions">'
			+ '  <button class="btn-sm btn-success test-one">Test</button>'
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

		list.appendChild(row);
	});
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function saveProvider(name) {
	await api('/providers/' + name, {
		method: 'POST',
		body: JSON.stringify({ endpoints: providerData[name] || [] }),
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

// ── Logout ──────────────────────────────────
document.getElementById('logout').addEventListener('click', () => {
	document.cookie = 'session=; Path=/; Max-Age=0';
	location.href = '/admin/login';
});
</script>
</body></html>`;
}
