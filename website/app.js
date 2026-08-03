/**
 * Agent Diaries Core — Website Interactive Script
 */

// ── Copy Command ────────────────────────────────────────────────────────────
function copyInstallCommand() {
  const text = "npm install @agent-diaries/core";
  navigator.clipboard.writeText(text).then(() => {
    const tooltip = document.querySelector('.copy-tooltip');
    if (tooltip) {
      tooltip.classList.add('show');
      setTimeout(() => tooltip.classList.remove('show'), 2000);
    }
  });
}

// ── Tab Switching ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  const activeContent = document.getElementById(tabId);
  if (activeContent) {
    activeContent.classList.add('active');
  }

  const eventTarget = event.currentTarget;
  if (eventTarget) {
    eventTarget.classList.add('active');
  }
}

// ── Interactive Savings Calculator ──────────────────────────────────────────
function updateCalculator() {
  const agents = parseInt(document.getElementById('agentsRange').value, 10);
  const tasksPerAgent = parseInt(document.getElementById('tasksRange').value, 10);
  const costPerMillion = parseFloat(document.getElementById('modelSelect').value);

  document.getElementById('agentsVal').textContent = agents;
  document.getElementById('tasksVal').textContent = tasksPerAgent;

  // Assuming 50% duplicate overlap in typical swarm workflows:
  const totalDailyTasks = agents * tasksPerAgent;
  const duplicateDailyTasks = Math.floor(totalDailyTasks * 0.49);
  const monthlyDuplicates = duplicateDailyTasks * 30;

  // Assuming ~1,000 tokens per task execution
  const tokensSavedMonthly = (monthlyDuplicates * 1000) / 1000000; // in Millions
  const dollarSavedMonthly = tokensSavedMonthly * costPerMillion;

  document.getElementById('calcCallsSaved').textContent = monthlyDuplicates.toLocaleString();
  document.getElementById('calcDollarSaved').textContent = `$${dollarSavedMonthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo`;
}

// ── Live Swarm Simulator ────────────────────────────────────────────────────
let isSimulating = false;

function startSwarmSimulation() {
  if (isSimulating) return;
  isSimulating = true;

  const agentCount = parseInt(document.getElementById('agentCountSelect').value, 10);
  const taskCount = parseInt(document.getElementById('taskCountSelect').value, 10);
  const runBtn = document.getElementById('runSimBtn');
  const simStatus = document.getElementById('simStatus');
  const term = document.getElementById('simTerminalLog');

  runBtn.disabled = true;
  runBtn.style.opacity = '0.6';
  simStatus.textContent = 'RUNNING';
  simStatus.style.color = '#10b981';

  term.innerHTML = '';

  const totalRequests = agentCount * taskCount;
  document.getElementById('statTotalRequests').textContent = totalRequests.toLocaleString();
  document.getElementById('statExecutions').textContent = '0';
  document.getElementById('statIntercepted').textContent = '0';
  document.getElementById('statSavings').textContent = '$0.00';

  const repos = [
    "vercel/next.js", "microsoft/vscode", "facebook/react", "vuejs/core", "sveltejs/svelte",
    "angular/angular", "denoland/deno", "nodejs/node", "prisma/prisma", "trpc/trpc",
    "supabase/supabase", "planetscale/database-js", "drizzle-team/drizzle-orm", "colinhacks/zod",
    "pmndrs/zustand", "tanstack/query", "vitejs/vite", "esbuild/esbuild", "biomejs/biome", "oxc-project/oxc"
  ];

  let executedCount = 0;
  let interceptedCount = 0;

  term.innerHTML += `<div class="log-line text-dim">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>`;
  term.innerHTML += `<div class="log-line text-dim">  Agent Swarm Initializing: ${agentCount} agents × ${taskCount} tasks (${totalRequests.toLocaleString()} total requests)</div>`;
  term.innerHTML += `<div class="log-line text-dim">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>`;

  let step = 0;
  const interval = setInterval(() => {
    step++;

    if (step <= taskCount) {
      executedCount++;
      const repo = repos[step % repos.length];
      term.innerHTML += `<div class="log-line log-exec">  [agent-${step % agentCount}] ✓ executeOnce("${repo}") → Executed 1x LLM call</div>`;
    } else if (step <= taskCount + 4) {
      interceptedCount += Math.floor((totalRequests - taskCount) / 4);
      const repo = repos[step % repos.length];
      term.innerHTML += `<div class="log-line log-hit">  [agent-${(step * 3) % agentCount}] ↩ executeOnce("${repo}") → Cache Hit (Duplicate prevented)</div>`;
    } else {
      clearInterval(interval);
      executedCount = taskCount;
      interceptedCount = totalRequests - taskCount;

      const costSaved = (interceptedCount * 0.015).toFixed(2);

      document.getElementById('statExecutions').textContent = executedCount.toLocaleString();
      document.getElementById('statIntercepted').textContent = interceptedCount.toLocaleString();
      document.getElementById('statSavings').textContent = `$${costSaved}`;

      term.innerHTML += `<div class="log-line text-dim">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>`;
      term.innerHTML += `<div class="log-line log-summary">  ✔ ${executedCount} Tasks Executed (1x per unique key)</div>`;
      term.innerHTML += `<div class="log-line log-summary">  ✔ ${interceptedCount.toLocaleString()} Duplicate Calls Intercepted</div>`;
      term.innerHTML += `<div class="log-line log-summary">  ✔ Wall Time: ~1.2s | LLM Cost Saved: $${costSaved}</div>`;
      term.innerHTML += `<div class="log-line text-dim">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>`;

      term.scrollTop = term.scrollHeight;

      simStatus.textContent = 'FINISHED';
      simStatus.style.color = '#9ca3af';
      runBtn.disabled = false;
      runBtn.style.opacity = '1';
      isSimulating = false;
      return;
    }

    document.getElementById('statExecutions').textContent = executedCount.toLocaleString();
    document.getElementById('statIntercepted').textContent = interceptedCount.toLocaleString();
    document.getElementById('statSavings').textContent = `$${(interceptedCount * 0.015).toFixed(2)}`;
    term.scrollTop = term.scrollHeight;

  }, 120);
}

// Initial calculation on page load
document.addEventListener('DOMContentLoaded', () => {
  updateCalculator();
});
