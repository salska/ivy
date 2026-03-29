/**
 * Generate the HTML dashboard page.
 * Self-contained — no external dependencies. Uses inline CSS and vanilla JS.
 */
export function generateDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ivy Health Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #050505; color: #ececec; padding: 32px; line-height: 1.5; }
  
  .container { max-width: 1200px; margin: 0 auto; }
  
  header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 32px; border-bottom: 1px solid #222; padding-bottom: 16px; }
  h1 { color: #fdfdfd; font-size: 1.8em; font-weight: 700; letter-spacing: -0.02em; }
  h1 span { color: #4fc3f7; font-weight: 300; }
  
  h2 { color: #81d4fa; margin: 32px 0 16px; font-size: 1.2em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

  .health-section { background: #111; padding: 24px; border-radius: 12px; border: 1px solid #222; margin-bottom: 32px; display: flex; align-items: center; gap: 32px; }
  .health-score-container { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
  .health-score-svg { transform: rotate(-90deg); width: 120px; height: 120px; }
  .health-score-bg { fill: none; stroke: #222; stroke-width: 8; }
  .health-score-fill { fill: none; stroke: #4fc3f7; stroke-width: 8; stroke-dasharray: 314.159; stroke-dashoffset: 314.159; transition: stroke-dashoffset 1s ease-out; stroke-linecap: round; }
  .health-score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
  .health-score-val { font-size: 2em; font-weight: 800; color: #fff; line-height: 1; }
  .health-score-label { font-size: 0.7em; color: #888; text-transform: uppercase; margin-top: 4px; }
  
  .health-meta { flex: 1; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
  .status-ok { background: rgba(76, 175, 80, 0.1); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.2); }
  .status-alert { background: rgba(255, 152, 0, 0.1); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.2); }
  .status-error { background: rgba(244, 67, 54, 0.1); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.2); }
  
  .health-summary-text { font-size: 1.1em; color: #aaa; max-width: 600px; }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: #111; padding: 20px; border-radius: 10px; border: 1px solid #222; }
  .stat-card-value { font-size: 1.8em; font-weight: 700; color: #fff; }
  .stat-card-label { font-size: 0.8em; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

  .checks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .check-card { background: #161616; padding: 16px; border-radius: 8px; border-left: 4px solid #333; transition: transform 0.2s; }
  .check-card:hover { transform: translateY(-2px); background: #1c1c1c; }
  .check-card.ok { border-left-color: #4caf50; }
  .check-card.alert { border-left-color: #ff9800; }
  .check-card.error { border-left-color: #f44336; }
  .check-card.disabled { border-left-color: #555; opacity: 0.6; }
  
  .check-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .check-name { font-weight: 700; font-size: 1em; color: #efefef; }
  .check-status-text { font-size: 0.7em; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; }
  
  .check-time { font-size: 0.75em; color: #888; margin-bottom: 4px; }
  .check-interval { font-size: 0.75em; color: #666; font-style: italic; }

  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.9em; background: #111; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 12px 16px; background: #1a1a1a; color: #81d4fa; font-weight: 600; font-size: 0.8em; text-transform: uppercase; }
  td { padding: 12px 16px; border-bottom: 1px solid #222; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #161616; }

  .search-box { margin: 24px 0; display: flex; gap: 12px; }
  .search-box input { flex: 1; padding: 12px 16px; background: #111; border: 1px solid #333; color: #fff; border-radius: 8px; font-family: inherit; font-size: 1em; }
  .search-box input:focus { border-color: #4fc3f7; outline: none; box-shadow: 0 0 0 2px rgba(79, 195, 247, 0.2); }
  .search-box button { padding: 12px 24px; background: #1a237e; color: #81d4fa; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: background 0.2s; }
  .search-box button:hover { background: #283593; }

  .refresh-note { color: #555; font-size: 0.8em; margin-top: 48px; text-align: center; }
  .refresh-link { color: #4fc3f7; text-decoration: none; border-bottom: 1px dashed #4fc3f7; }

  .tag { font-size: 0.7em; background: #333; color: #eee; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
  
  @media (max-width: 768px) {
    .health-section { flex-direction: column; text-align: center; }
    .stats-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>IVY <span>HEALTH</span></h1>
    <div id="last-updated" style="font-size: 0.8em; color: #666;"></div>
  </header>

  <div id="health-dashboard"></div>

  <div class="stats-grid" id="main-stats"></div>

  <h2>System Checklist</h2>
  <div class="checks-grid" id="checks-grid"></div>

  <h2>Search Events</h2>
  <div class="search-box">
    <input type="text" id="search-input" placeholder="Search events..." onkeyup="if(event.key==='Enter')doSearch()">
    <button onclick="doSearch()">Search</button>
  </div>
  <div id="search-results"></div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 32px;">
    <div>
      <h2>Recent Events</h2>
      <div id="events"></div>
    </div>
    <div>
      <h2>Active Heartbeats</h2>
      <div id="heartbeats"></div>
    </div>
  </div>

  <p class="refresh-note">
    Automatic synchronization every 30 seconds. 
    <a href="#" onclick="refresh();return false" class="refresh-link">Synchronize Now</a>
  </p>
</div>

<script>
async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return res.json();
  } catch (e) {
    console.error('Fetch error:', e);
    return null;
  }
}

function relTime(ts) {
  if (!ts) return 'never';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 10) return 'just now';
  if (d < 60) return Math.round(d) + 's ago';
  if (d < 3600) return Math.round(d/60) + 'm ago';
  if (d < 86400) return Math.round(d/3600) + 'h ago';
  return Math.round(d/86400) + 'd ago';
}

function statusClass(s) { 
  s = (s || '').toLowerCase();
  if (s === 'ok' || s === 'success') return 'ok';
  if (s === 'alert' || s === 'warning') return 'alert';
  if (s === 'error' || s === 'fail' || s === 'critical') return 'error';
  if (s === 'disabled') return 'disabled';
  return '';
}

async function loadData() {
  const s = await fetchJSON('/api/summary');
  if (!s) return;

  document.getElementById('last-updated').innerText = 'Last updated: ' + new Date().toLocaleTimeString();

  // Health Dashboard
  const dash = document.getElementById('health-dashboard');
  const offset = 314.159 - (s.healthScore / 100) * 314.159;
  const statusLabel = s.overallStatus.toUpperCase();
  const healthColor = s.healthScore > 80 ? '#4caf50' : s.healthScore > 50 ? '#ff9800' : '#f44336';
  
  dash.innerHTML = \`
    <div class="health-section">
      <div class="health-score-container">
        <svg class="health-score-svg">
          <circle class="health-score-bg" cx="60" cy="60" r="50"></circle>
          <circle class="health-score-fill" cx="60" cy="60" r="50" style="stroke-dashoffset: \${offset}; stroke: \${healthColor}"></circle>
        </svg>
        <div class="health-score-text">
          <div class="health-score-val">\${Math.round(s.healthScore)}</div>
          <div class="health-score-label">Score</div>
        </div>
      </div>
      <div class="health-meta">
        <div class="status-badge status-\${s.overallStatus}">System \${statusLabel}</div>
        <div class="health-summary-text">
          \${s.healthScore === 100 ? 'All systems operational. No issues detected in current heartbeats.' : 
            s.healthScore > 80 ? 'System is healthy with minor alerts.' :
            s.healthScore > 50 ? 'System performance is degraded. Please check alerts.' :
            'Critical issues detected. Immediate intervention required.'}
        </div>
      </div>
    </div>
  \`;

  // Main Stats
  document.getElementById('main-stats').innerHTML = \`
    <div class="stat-card">
      <div class="stat-card-value">\${s.totalEvents}</div>
      <div class="stat-card-label">Recent Events</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">\${s.activeAgents}</div>
      <div class="stat-card-label">Active Agents</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">\${relTime(s.lastHeartbeat)}</div>
      <div class="stat-card-label">Last Activity</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">\${s.allChecks.filter(c => c.enabled).length}</div>
      <div class="stat-card-label">Active Checks</div>
    </div>
  \`;

  // Checks Grid
  const checksGrid = document.getElementById('checks-grid');
  if (s.allChecks && s.allChecks.length) {
    checksGrid.innerHTML = s.allChecks.map(c => \`
      <div class="check-card \${statusClass(c.status)}">
        <div class="check-header">
          <div class="check-name">\${c.name}</div>
          <div class="check-status-text status-\${statusClass(c.status)}">\${c.status}</div>
        </div>
        <div class="check-time">Last run: \${relTime(c.time)}</div>
        <div class="check-interval">Interval: \${c.interval_minutes}m • Severity: \${c.severity}</div>
      </div>
    \`).join('');
  } else {
    checksGrid.innerHTML = '<p>No checks defined.</p>';
  }

  // Events Table
  const events = await fetchJSON('/api/events?limit=15');
  const eventsDiv = document.getElementById('events');
  if (events && events.length) {
    eventsDiv.innerHTML = '<table><tr><th>Time</th><th>Type</th><th>Summary</th></tr>' +
      events.map(e => \`<tr><td style="white-space:nowrap">\${relTime(e.timestamp)}</td><td><span class="tag">\${e.event_type}</span></td><td title="\${e.summary}">\${e.summary.length > 60 ? e.summary.slice(0, 57) + '...' : e.summary}</td></tr>\`).join('') + '</table>';
  } else {
    eventsDiv.innerHTML = '<p>No recent events.</p>';
  }

  // Heartbeats Table
  const hbs = await fetchJSON('/api/heartbeats?limit=10');
  const hbsDiv = document.getElementById('heartbeats');
  if (hbs && hbs.length) {
    hbsDiv.innerHTML = '<table><tr><th>Time</th><th>Session</th><th>Progress</th></tr>' +
      hbs.map(h => \`<tr><td style="white-space:nowrap">\${relTime(h.timestamp)}</td><td><code>\${(h.session_id||'').slice(0,8)}</code></td><td>\${(h.progress||'-').length > 50 ? h.progress.slice(0, 47) + '...' : h.progress}</td></tr>\`).join('') + '</table>';
  } else {
    hbsDiv.innerHTML = '<p>No active heartbeats.</p>';
  }
}

async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const results = await fetchJSON('/api/search?q=' + encodeURIComponent(q));
  const resDiv = document.getElementById('search-results');
  if (!results || !results.length) { resDiv.innerHTML = '<p style="padding:16px;color:#888">No results found for "' + q + '".</p>'; return; }
  resDiv.innerHTML = '<table><tr><th>Rank</th><th>Time</th><th>Summary</th></tr>' +
    results.map(r => \`<tr><td>\${r.rank.toFixed(2)}</td><td style="white-space:nowrap">\${relTime(r.event.timestamp)}</td><td>\${r.event.summary}</td></tr>\`).join('') + '</table>';
}

function refresh() { loadData(); }
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
}
