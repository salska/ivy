/**
 * Generate the Monitoring Dashboard HTML.
 * Visualizes Semantic Cache hits, similarity distribution, and latency.
 */
export function renderMonitoringPanel(): string {
  return `
<div class="monitoring-container">
  <style>
    .monitoring-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      padding: 20px;
    }
    .metric-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .metric-card h3 {
      color: #8b949e;
      font-size: 14px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .chart-container {
      position: relative;
      height: 200px;
      width: 100%;
    }
    .big-value {
      font-size: 32px;
      font-weight: bold;
      color: #58a6ff;
      margin: 10px 0;
    }
    .status-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      display: inline-block;
    }
    .status-ok { background: #238636; color: #fff; }
    .status-warning { background: #9e6a03; color: #fff; }
    .status-error { background: #da3633; color: #fff; }
  </style>

  <div class="monitoring-grid">
    <!-- Row 1: Key Performance Indicators -->
    <div class="metric-card">
      <h3>Cache Hit Rate (Semantic)</h3>
      <div id="hit-rate-value" class="big-value">0%</div>
      <div class="chart-container">
        <canvas id="hitRateChart"></canvas>
      </div>
    </div>

    <div class="metric-card">
      <h3>Similarity Distribution</h3>
      <div class="chart-container">
        <canvas id="similarityChart"></canvas>
      </div>
    </div>

    <div class="metric-card">
      <h3>Perceptual Budget (Latency)</h3>
      <div id="latency-value" class="big-value">0ms</div>
      <div class="chart-container">
        <canvas id="latencyChart"></canvas>
      </div>
    </div>
  </div>

  <div class="monitoring-grid">
    <!-- Row 2: Detailed Breakdown -->
    <div class="metric-card" style="grid-column: span 2;">
      <h3>Economic Impact (Token Savings)</h3>
      <div class="chart-container" style="height: 300px;">
        <canvas id="savingsChart"></canvas>
      </div>
    </div>
    
    <div class="metric-card">
      <h3>System Health</h3>
      <div id="health-status" style="margin-top: 10px;">
        <div class="status-badge status-ok">OPERATIONAL</div>
      </div>
      <ul style="margin-top: 20px; font-size: 13px; color: #c9d1d9; list-style: none;">
        <li style="margin-bottom: 8px;">• Qdrant: <span class="status-ok" style="background:none">Connected</span></li>
        <li style="margin-bottom: 8px;">• Redis: <span class="status-ok" style="background:none">Connected</span></li>
        <li style="margin-bottom: 8px;">• Embeddings: <span class="status-warning" style="background:none">High Latency</span></li>
      </ul>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const charts = {};

    function initCharts() {
      // Hit Rate Chart
      charts.hitRate = new Chart(document.getElementById('hitRateChart'), {
        type: 'doughnut',
        data: {
          labels: ['Hit', 'Miss'],
          datasets: [{
            data: [0, 100],
            backgroundColor: ['#238636', '#30363d'],
            borderWidth: 0
          }]
        },
        options: {
          cutout: '80%',
          plugins: { legend: { display: false } }
        }
      });

      // Similarity Chart
      charts.similarity = new Chart(document.getElementById('similarityChart'), {
        type: 'bar',
        data: {
          labels: ['0.7', '0.75', '0.8', '0.85', '0.9', '0.95', '1.0'],
          datasets: [{
            label: 'Hits',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#58a6ff'
          }]
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { display: false, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: '#8b949e' } }
          }
        }
      });

      // Latency Chart
      charts.latency = new Chart(document.getElementById('latencyChart'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Latency (ms)',
            data: [],
            borderColor: '#f0883e',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0
          }]
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { display: true, beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
            x: { display: false }
          }
        }
      });

      // Savings Chart
      charts.savings = new Chart(document.getElementById('savingsChart'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { label: 'Saved ($)', data: [], borderColor: '#238636', fill: true, backgroundColor: 'rgba(35, 134, 54, 0.1)' },
            { label: 'Spent ($)', data: [], borderColor: '#da3633', fill: true, backgroundColor: 'rgba(218, 54, 51, 0.1)' }
          ]
        },
        options: {
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
            x: { grid: { display: false }, ticks: { color: '#8b949e' } }
          }
        }
      });
    }

    async function updateDashboard() {
      try {
        const res = await fetch('/api/metrics/monitoring');
        const data = await res.json();
        
        // Update Hit Rate
        const hitRate = (data.hits / (data.hits + data.misses || 1) * 100).toFixed(1);
        document.getElementById('hit-rate-value').innerText = hitRate + '%';
        charts.hitRate.data.datasets[0].data = [data.hits, data.misses];
        charts.hitRate.update();

        // Update Similarity
        charts.similarity.data.datasets[0].data = data.similarityBuckets;
        charts.similarity.update();

        // Update Latency
        document.getElementById('latency-value').innerText = data.currentLatency + 'ms';
        charts.latency.data.labels.push('');
        charts.latency.data.datasets[0].data.push(data.currentLatency);
        if (charts.latency.data.labels.length > 20) {
          charts.latency.data.labels.shift();
          charts.latency.data.datasets[0].data.shift();
        }
        charts.latency.update();

        // Update Savings
        // ... savings logic
        charts.savings.update();

      } catch (e) {
        console.error('Failed to update dashboard:', e);
      }
    }

    initCharts();
    setInterval(updateDashboard, 2000);
    updateDashboard();
  </script>
</div>
`;
}
