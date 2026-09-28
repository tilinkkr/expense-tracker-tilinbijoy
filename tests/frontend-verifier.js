"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { extname, join, normalize, resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..");
const browserPaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function interfaceSuite() {
  const results = [];
  const check = (condition, name, details = "") => {
    if (!condition) throw new Error(`${name}: ${details}`);
    results.push(name);
  };
  const frames = () => new Promise((resolveFrame) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
  );
  const waitFor = async (predicate, timeout = 3000) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > timeout) throw new Error("Timed out waiting for UI state.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  };
  const setValue = (id, value, eventName = "input") => {
    const element = document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  };
  const form = document.getElementById("txForm");
  const modal = document.getElementById("transactionModal");
  const fab = document.getElementById("mainFabBtn");
  const today = (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  })();

  let alertCalls = 0;
  window.alert = () => { alertCalls += 1; };

  const requiredIds = [
    "kpiIncome", "kpiExpense", "cardSpendingText", "cardProgressFill",
    "trajectoryCanvas", "allocationTotal", "categoryLegendList", "transactionsTable",
    "tableBody", "emptyStateView", "recordCounter", "filterType", "filterCategory",
    "searchQuery", "pageSizeSelect", "prevPage", "nextPage", "pageStatus", "mainFabBtn",
    "transactionModal", "modalWindow", "txForm", "txAmount", "txCategory", "txDate",
    "txDesc", "amountError", "categoryError", "dateError", "descError", "closeModalBtn",
    "cancelModalBtn", "exportBtn", "importBtn", "csvFileInput", "themeToggleBtn",
  ];
  check(requiredIds.every((id) => document.getElementById(id)), "Semantic interface contract");
  check(
    ["kpiBalance", "kpiIncome", "kpiExpense"].every(
      (id) => document.getElementById(id).textContent === "$0.00",
    ),
    "Clean initial KPI state",
  );
  check(!/NaN|undefined/.test(document.body.innerText), "No invalid value leakage");
  check(document.querySelectorAll("#timeframeSelect option").length === 3, "Timeframe controls");

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  check(document.activeElement.id === "searchQuery", "Global search shortcut");

  fab.click();
  await frames();
  check(!modal.hidden && !modal.classList.contains("hidden") && fab.classList.contains("active"), "FAB opens modal");
  check(document.activeElement.id === "txAmount", "Modal amount autofocus");
  const firstFocusable = document.getElementById("closeModalBtn");
  const lastFocusable = form.querySelector('button[type="submit"]');
  lastFocusable.focus();
  modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  check(document.activeElement === firstFocusable, "Forward focus trap");
  firstFocusable.focus();
  modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  check(document.activeElement === lastFocusable, "Reverse focus trap");

  setValue("txAmount", "");
  form.requestSubmit();
  check(document.getElementById("amountError").textContent.length > 0 && !modal.hidden, "Inline amount validation");
  setValue("txAmount", "-2");
  form.requestSubmit();
  check(document.getElementById("amountError").textContent.length > 0 && !modal.hidden, "Negative amount validation");
  setValue("txAmount", "not-a-number");
  form.requestSubmit();
  check(document.getElementById("amountError").textContent.length > 0 && !modal.hidden, "String amount validation");
  setValue("txAmount", "100");
  setValue("txCategory", "Food", "change");
  setValue("txDesc", "");
  form.requestSubmit();
  check(document.getElementById("descError").textContent.length > 0, "Inline description validation");
  modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check(modal.hidden && document.activeElement === fab && !fab.classList.contains("active"), "Escape closes modal and restores focus");
  fab.click();
  await frames();
  modal.click();
  check(modal.hidden, "Overlay dismissal");

  const addTransaction = async ({ type, amount, category, description }) => {
    fab.click();
    await frames();
    form.querySelector(`input[value="${type}"]`).click();
    setValue("txAmount", amount);
    setValue("txCategory", category, "change");
    setValue("txDate", today, "change");
    setValue("txDesc", description);
    form.requestSubmit();
    await frames();
  };
  await addTransaction({ type: "income", amount: "3000.00", category: "Salary", description: "Paycheck" });
  await addTransaction({ type: "expense", amount: "800.00", category: "Food", description: "Groceries" });

  check(document.getElementById("kpiIncome").textContent === "$3,000.00", "Inflow KPI projection");
  check(document.getElementById("kpiExpense").textContent === "$800.00", "Outflow KPI projection");
  check(document.getElementById("kpiBalance").textContent === "$2,200.00", "Net position projection");
  check(document.querySelectorAll("#tableBody tr").length === 2, "Ledger row projection");
  check(document.querySelectorAll(".badge-income").length === 1 && document.querySelectorAll(".badge-expense").length === 1, "Transaction type badges");
  check(document.getElementById("recordCounter").textContent === "2 records", "Record counter");
  check(document.getElementById("monthlyLimit").textContent.includes("$3,000.00"), "Dynamic card limit");
  check(document.getElementById("budgetUsed").textContent === "Used: 27%", "Dynamic card usage");
  check(
    Math.abs(parseFloat(document.getElementById("cardProgressFill").style.width) - (800 / 3000) * 100) < 0.0001,
    "Card progress fill",
  );
  check(document.getElementById("allocationTotal").textContent === "$800.00", "Allocation total");
  check(document.getElementById("categoryLegendList").innerText.includes("Food"), "Allocation legend");
  check(document.querySelectorAll("#spectrumLineBar .spectrum-segment").length === 1, "Allocation spectrum");

  const nonZeroPixels = (id) => {
    const canvas = document.getElementById(id);
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0);
  };
  check(nonZeroPixels("trajectoryCanvas"), "Trajectory canvas rasterization");
  check(nonZeroPixels("inflowSparkline") && nonZeroPixels("outflowSparkline"), "Sparkline rasterization");

  const expenseFilter = document.querySelector('[data-filter-type="expense"]');
  expenseFilter.click();
  setValue("filterCategory", "Food", "change");
  setValue("searchQuery", "gro");
  check(document.querySelectorAll("#tableBody tr").length === 1 && document.getElementById("tableBody").innerText.includes("Groceries"), "Compound ledger filtering");
  setValue("searchQuery", "NoMatch");
  check(document.querySelectorAll("#tableBody tr").length === 0 && !document.getElementById("emptyStateView").hidden, "Filtered empty state");
  document.querySelector('[data-filter-type="all"]').click();
  setValue("filterCategory", "all", "change");
  setValue("searchQuery", "");
  check(document.querySelectorAll("#tableBody tr").length === 2, "Filter reset");

  const groceryRow = [...document.querySelectorAll("#tableBody tr")].find((row) => row.innerText.includes("Groceries"));
  groceryRow.querySelector('[data-action="edit"]').click();
  check(document.getElementById("txAmount").value === "800.00" && document.getElementById("txDesc").value === "Groceries", "Edit form population");
  setValue("txAmount", "850.00");
  form.requestSubmit();
  await frames();
  check(document.querySelectorAll("#tableBody tr").length === 2 && document.getElementById("kpiBalance").textContent === "$2,150.00" && document.getElementById("kpiExpense").textContent === "$850.00", "Immutable edit transition");
  const editedRow = [...document.querySelectorAll("#tableBody tr")].find((row) => row.innerText.includes("Groceries"));
  editedRow.querySelector('[data-action="delete"]').click();
  await frames();
  check(document.querySelectorAll("#tableBody tr").length === 1 && document.getElementById("kpiExpense").textContent === "$0.00", "Delegated delete transition");

  const lightTheme = document.documentElement.dataset.theme;
  document.getElementById("themeToggleBtn").click();
  check(document.documentElement.dataset.theme !== lightTheme, "Theme switching");
  document.getElementById("themeToggleBtn").click();

  let exportedBlob = null;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => { exportedBlob = blob; return originalCreateObjectURL.call(URL, blob); };
  HTMLAnchorElement.prototype.click = function click() {};
  document.getElementById("exportBtn").click();
  await waitFor(() => exportedBlob !== null);
  const csv = await exportedBlob.text();
  URL.createObjectURL = originalCreateObjectURL;
  HTMLAnchorElement.prototype.click = originalClick;
  check(csv.startsWith("id,type,amount,category,date,description\r\n") && csv.includes("Paycheck"), "RFC 4180 CSV export");

  const importCsv = [
    "id,type,amount,category,date,description",
    `external-id,expense,75.25,Food,${today},"Dinner, ""with"" client"`,
  ].join("\r\n");
  const file = new File([importCsv], "import.csv", { type: "text/csv" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const fileInput = document.getElementById("csvFileInput");
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(() => document.querySelectorAll("#tableBody tr").length === 2);
  check(document.getElementById("tableBody").innerText.includes('Dinner, "with" client'), "RFC 4180 CSV import");
  const persisted = JSON.parse(localStorage.getItem("ledgerly.transactions.v1"));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  check(persisted.length === 2 && persisted.every(({ id }) => uuid.test(id)), "Persistent UUID state");
  check(alertCalls === 0, "No blocking alerts");
  return results;
}

async function persistenceSuite() {
  const results = [];
  const check = (condition, name) => {
    if (!condition) throw new Error(name);
    results.push(name);
  };
  const frames = () => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  const setValue = (id, value, eventName = "input") => {
    const element = document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  };
  check(
    document.querySelectorAll("#tableBody tr").length === 2 &&
      document.getElementById("kpiIncome").textContent === "$3,000.00" &&
      document.getElementById("kpiExpense").textContent === "$75.25",
    "Reload persistence hydration",
  );
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem() {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  };
  document.getElementById("mainFabBtn").click();
  await frames();
  document.querySelector('#txForm input[value="income"]').click();
  setValue("txAmount", "1.00");
  setValue("txCategory", "Salary", "change");
  setValue("txDate", (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  })(), "change");
  setValue("txDesc", "Quota fallback entry");
  document.getElementById("txForm").requestSubmit();
  await frames();
  Storage.prototype.setItem = originalSetItem;
  check(document.querySelectorAll("#tableBody tr").length === 3 && document.getElementById("tableBody").innerText.includes("Quota fallback entry"), "QuotaExceededError memory fallback");
  const bulkRows = ["id,type,amount,category,date,description"];
  const today = (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  })();
  for (let index = 0; index < 75; index += 1) {
    bulkRows.push(`bulk-${index},expense,1.00,Food,${today},Bulk ${index}`);
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([bulkRows.join("\r\n")], "bulk.csv", { type: "text/csv" }));
  const fileInput = document.getElementById("csvFileInput");
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  setValue("pageSizeSelect", "50", "change");
  await frames();
  check(document.querySelectorAll("#tableBody tr").length === 50, "DOM pagination render cap");
  return results;
}

function buildHarnessHTML() {
  const firstSuite = JSON.stringify(`(${interfaceSuite.toString()})()`);
  const secondSuite = JSON.stringify(`(${persistenceSuite.toString()})()`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA_RUNNING</title></head>
<body data-status="running" data-count="0"><img src="/__hold__" hidden><pre id="result">RUNNING</pre>
<script>(async()=>{const results=[];const frame=document.createElement("iframe");const nextLoad=()=>new Promise(resolve=>frame.addEventListener("load",resolve,{once:true}));try{const firstLoad=nextLoad();frame.src="/";document.body.append(frame);await firstLoad;results.push(...await frame.contentWindow.eval(${firstSuite}));const reload=nextLoad();frame.contentWindow.location.reload();await reload;results.push(...await frame.contentWindow.eval(${secondSuite}));document.body.dataset.status="passed";document.body.dataset.count=String(results.length);document.getElementById("result").textContent=JSON.stringify(results);document.title="QA_PASSED"}catch(error){document.body.dataset.status="failed";document.getElementById("result").textContent=error.stack||error.message;document.title="QA_FAILED"}finally{await fetch("/__release__")}})();</script>
</body></html>`;
}

function startStaticServer() {
  const heldResponses = [];
  const server = createServer((request, response) => {
    const requestedPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (requestedPath === "/__hold__") {
      heldResponses.push(response);
      return;
    }
    if (requestedPath === "/__release__") {
      heldResponses.splice(0).forEach((held) => held.writeHead(204).end());
      response.writeHead(204).end();
      return;
    }
    if (requestedPath === "/__qa__") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(buildHarnessHTML());
      return;
    }
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const absolutePath = normalize(join(projectRoot, relativePath));
    if (!absolutePath.startsWith(projectRoot)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const fileContents = readFileSync(absolutePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(absolutePath)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(fileContents);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function runHeadless(browserPath, url, profilePath) {
  return new Promise((resolveRun, rejectRun) => {
    const browser = spawn(browserPath, [
      "--headless=new", "--disable-background-networking", "--disable-default-apps",
      "--disable-extensions", "--disable-gpu", "--disable-gpu-sandbox",
      "--disable-gpu-shader-disk-cache", "--no-sandbox", "--no-first-run",
      "--no-default-browser-check", "--dump-dom", "--virtual-time-budget=15000",
      `--user-data-dir=${profilePath}`, url,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      browser.kill();
      rejectRun(new Error("Headless interface suite timed out."));
    }, 30_000);
    browser.stdout.setEncoding("utf8");
    browser.stderr.setEncoding("utf8");
    browser.stdout.on("data", (chunk) => { stdout += chunk; });
    browser.stderr.on("data", (chunk) => { stderr += chunk; });
    browser.once("error", (error) => { clearTimeout(timeout); rejectRun(error); });
    browser.once("close", (code) => { clearTimeout(timeout); resolveRun({ code, stdout, stderr }); });
  });
}

async function run() {
  const browserPath = browserPaths.find(existsSync);
  assert.ok(browserPath, "No supported Chromium browser was found.");
  const server = await startStaticServer();
  const profilePath = mkdtempSync(join(tmpdir(), "spendikkoo-headless-"));
  try {
    const { port } = server.address();
    const execution = await runHeadless(browserPath, `http://127.0.0.1:${port}/__qa__`, profilePath);
    const status = execution.stdout.match(/<body[^>]*data-status="([^"]+)"/i)?.[1];
    const count = Number(execution.stdout.match(/<body[^>]*data-count="([^"]+)"/i)?.[1] ?? 0);
    if (execution.code !== 0 || status !== "passed") {
      const resultText = execution.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/i)?.[1];
      throw new Error(resultText || execution.stderr || "Headless interface suite did not report success.");
    }
    process.stdout.write(`Frontend Test Results: ${count}/${count} PASSED (100%).\n`);
    process.exitCode = 0;
  } finally {
    server.close();
    if (resolve(profilePath).startsWith(resolve(tmpdir()))) rmSync(profilePath, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`Frontend Test Results: FAILED\n${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
