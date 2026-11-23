let chartLibraryPromise;
let cashflowChart;
let categoryChart;
let netWorthChart;
const sparkCharts = new Map();

function loadChartLibrary() {
  if (globalThis.Chart) return Promise.resolve(globalThis.Chart);
  if (!chartLibraryPromise) {
    chartLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
      script.async = true;
      script.onload = () => globalThis.Chart
        ? resolve(globalThis.Chart)
        : reject(new Error("Chart.js loaded without exposing its API."));
      script.onerror = () => {
        script.remove();
        chartLibraryPromise = null;
        reject(new Error("Chart.js could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return chartLibraryPromise;
}

export async function renderSparkline(id, values, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const Chart = await loadChartLibrary();
  if (!canvas.isConnected) return;
  sparkCharts.get(id)?.destroy();
  canvas.width = canvas.parentElement?.offsetWidth || 180;
  canvas.height = 40;
  sparkCharts.set(id, new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: values.map((_, index) => index),
      datasets: [{
        data: values,
        borderColor: color,
        borderWidth: 1.5,
        fill: false,
        tension: 0.35,
        pointRadius: 0
      }]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  }));
}

export async function renderCashflow(canvas, monthly, formatAmount) {
  if (!canvas) return;
  const Chart = await loadChartLibrary();
  if (!canvas.isConnected) return;
  const months = Object.keys(monthly || {}).sort();
  const labels = months.map(month => {
    const [year, monthNumber] = month.split("-");
    return new Date(Number(year), Number(monthNumber) - 1).toLocaleDateString(
      "en-US", { month: "short", year: "2-digit" }
    );
  });
  const income = months.map(month => Number(monthly[month]?.income || 0));
  const expense = months.map(month => Number(monthly[month]?.expense || 0));

  cashflowChart?.destroy();
  cashflowChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Income",
          data: income,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,.08)",
          fill: true,
          tension: .35,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: "Expenses",
          data: expense,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,.06)",
          fill: true,
          tension: .35,
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: context => " " + formatAmount(context.parsed.y) }
        }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.04)" } },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,.04)" },
          ticks: { callback: value => formatAmount(value) }
        }
      }
    }
  });
}

export async function renderCategories(canvas, entries, colors) {
  if (!canvas || !entries.length) return;
  const Chart = await loadChartLibrary();
  if (!canvas.isConnected) return;
  categoryChart?.destroy();
  categoryChart = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: entries.map(([category]) => category),
      datasets: [{
        data: entries.map(([, amount]) => amount),
        backgroundColor: colors.slice(0, entries.length),
        borderWidth: 0,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "72%",
      plugins: { legend: { display: false } }
    }
  });
}

export async function renderNetWorth(canvas, history) {
  if (!canvas || !history.length) return;
  const Chart = await loadChartLibrary();
  if (!canvas.isConnected) return;
  netWorthChart?.destroy();
  netWorthChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: history.map(item => item.month),
      datasets: [{
        data: history.map(item => item.net_worth),
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.08)",
        borderWidth: 2,
        fill: true,
        tension: .35,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}
