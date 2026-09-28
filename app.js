import {
  computeFinancialMetrics,
  formatCurrency,
  generateUUID,
  parseCSV,
  serializeToCSV,
  toCents,
} from "./analytics.js";
import { SafeStorage } from "./storage.js";

const TRANSACTIONS_KEY = "ledgerly.transactions.v1";
const THEME_KEY = "ledgerly.theme.v1";
const INCOME_CATEGORIES = ["Salary", "Freelance", "Investment", "Refund", "Other Income"];
const EXPENSE_CATEGORIES = [
  "Housing",
  "Food",
  "Transport",
  "Utilities",
  "Healthcare",
  "Entertainment",
  "Education",
  "Shopping",
  "Other Expense",
];
const CATEGORY_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#84cc16",
];

const storage = new SafeStorage();
const elements = {
  searchQuery: byId("searchQuery"),
  timeframe: byId("timeframeSelect"),
  calendarText: byId("calendarBadgeText"),
  exportButton: byId("exportBtn"),
  themeButton: byId("themeToggleBtn"),
  balance: byId("kpiBalance"),
  income: byId("kpiIncome"),
  expense: byId("kpiExpense"),
  inflowSparkline: byId("inflowSparkline"),
  outflowSparkline: byId("outflowSparkline"),
  monthlyLimit: byId("monthlyLimit"),
  budgetUsed: byId("budgetUsed"),
  progress: byId("cardProgressFill"),
  progressTrack: document.querySelector(".card-progress"),
  rangeTabs: byId("chartRangeTabs"),
  compareToggle: byId("trajectoryFilterBtn"),
  trajectoryCanvas: byId("trajectoryCanvas"),
  trajectoryDescription: byId("trajectoryDescription"),
  tooltip: byId("canvasTooltip"),
  allocationTotal: byId("allocationTotal"),
  spectrum: byId("spectrumLineBar"),
  categoryLegend: byId("categoryLegendList"),
  filterCategory: byId("filterCategory"),
  pageSize: byId("pageSizeSelect"),
  recordCounter: byId("recordCounter"),
  tableBody: byId("tableBody"),
  emptyState: byId("emptyStateView"),
  visibleTotal: byId("ledgerVisibleTotal"),
  previousPage: byId("prevPage"),
  nextPage: byId("nextPage"),
  pageStatus: byId("pageStatus"),
  fab: byId("mainFabBtn"),
  modal: byId("transactionModal"),
  modalTitle: byId("modalTitle"),
  closeModal: byId("closeModalBtn"),
  cancelModal: byId("cancelModalBtn"),
  form: byId("txForm"),
  amount: byId("txAmount"),
  category: byId("txCategory"),
  date: byId("txDate"),
  description: byId("txDesc"),
  importInput: byId("csvFileInput"),
  toastRack: byId("toastRack"),
};

const state = {
  transactions: loadTransactions(),
  filters: { type: "all", category: "all", query: "" },
  pagination: { page: 1, pageSize: 10 },
  timeframe: "month",
  chartMonths: 6,
  compareExpenses: true,
  editingId: null,
};

let modalTrigger = elements.fab;
let chartFrame = 0;
let chartHitRegions = [];

initialize();

function initialize() {
  initializeTheme();
  updateCalendarBadge();
  bindEvents();
  render();
  observeCharts();
}

function bindEvents() {
  elements.searchQuery.addEventListener("input", handleSearch);
  elements.timeframe.addEventListener("change", handleTimeframeChange);
  elements.exportButton.addEventListener("click", exportTransactions);
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.rangeTabs.addEventListener("click", handleRangeChange);
  elements.compareToggle.addEventListener("click", handleCompareToggle);
  elements.filterCategory.addEventListener("change", handleLedgerFilter);
  elements.pageSize.addEventListener("change", handlePageSizeChange);
  elements.previousPage.addEventListener("click", () => changePage(-1));
  elements.nextPage.addEventListener("click", () => changePage(1));
  elements.tableBody.addEventListener("click", handleLedgerAction);
  document.querySelectorAll("[data-filter-type]").forEach((button) =>
    button.addEventListener("click", handleTypeFilter),
  );

  elements.fab.addEventListener("click", handleFabClick);
  elements.closeModal.addEventListener("click", closeTransactionModal);
  elements.cancelModal.addEventListener("click", closeTransactionModal);
  elements.modal.addEventListener("click", handleOverlayClick);
  elements.modal.addEventListener("keydown", handleModalKeydown);
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.form.addEventListener("input", clearErrorOnInput);
  elements.form.addEventListener("change", handleFormChange);
  elements.importInput.addEventListener("change", importTransactions);
  elements.trajectoryCanvas.addEventListener("pointermove", handleChartPointerMove);
  elements.trajectoryCanvas.addEventListener("pointerleave", hideChartTooltip);
  document.addEventListener("keydown", handleGlobalShortcut);
}

function transitionTransactions(transactions, action) {
  switch (action.type) {
    case "add":
      return [...transactions, action.transaction];
    case "edit":
      return transactions.map((transaction) =>
        transaction.id === action.transaction.id ? action.transaction : transaction,
      );
    case "delete":
      return transactions.filter((transaction) => transaction.id !== action.id);
    case "import":
      return [...transactions, ...action.transactions];
    default:
      return transactions;
  }
}

function commitTransactionAction(action, message) {
  state.transactions = transitionTransactions(state.transactions, action);
  state.pagination.page = 1;
  storage.setItem(TRANSACTIONS_KEY, state.transactions);
  render();
  if (message) {
    showToast(message, "success");
  }
}

function render() {
  const periodTransactions = getPeriodTransactions();
  const metrics = computeFinancialMetrics(periodTransactions);
  renderKPIs(metrics);
  renderVirtualCard(metrics);
  renderAllocation(metrics);
  renderCategoryFilter();
  renderLedger();
  scheduleChartRender(metrics);
}

function renderKPIs(metrics) {
  elements.balance.textContent = formatCurrency(metrics.balanceCents);
  elements.income.textContent = formatCurrency(metrics.totalIncomeCents);
  elements.expense.textContent = formatCurrency(metrics.totalExpenseCents);
  elements.balance.dataset.sign = metrics.balanceCents < 0 ? "negative" : "positive";
}

function renderVirtualCard(metrics) {
  const limit = metrics.totalIncomeCents;
  const usedPercent = limit > 0
    ? Math.min(100, Math.max(0, (metrics.totalExpenseCents / limit) * 100))
    : 0;
  elements.monthlyLimit.textContent = `Monthly Limit: ${formatCurrency(limit)}`;
  elements.budgetUsed.textContent = `Used: ${Math.round(usedPercent)}%`;
  elements.progress.style.width = `${usedPercent}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(usedPercent)));
}

function renderAllocation(metrics) {
  elements.allocationTotal.textContent = formatCurrency(metrics.totalExpenseCents);
  const entries = [...metrics.categorySpendMap.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((left, right) => right[1] - left[1]);
  const spectrumFragment = document.createDocumentFragment();
  const legendFragment = document.createDocumentFragment();

  if (entries.length === 0) {
    elements.spectrum.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "allocation-empty";
    empty.textContent = "Add an expense to reveal your allocation mix.";
    elements.categoryLegend.replaceChildren(empty);
    return;
  }

  entries.forEach(([category, amount], index) => {
    const percentage = (amount / metrics.totalExpenseCents) * 100;
    const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];

    const segment = document.createElement("span");
    segment.className = "spectrum-segment";
    segment.style.width = `${percentage}%`;
    segment.style.backgroundColor = color;
    segment.title = `${category}: ${formatCurrency(amount)}`;
    spectrumFragment.append(segment);

    const row = document.createElement("div");
    row.className = "category-legend-row";
    const badge = document.createElement("span");
    badge.className = "category-micro-badge";
    badge.style.backgroundColor = color;
    badge.style.color = color;
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = category;
    const value = document.createElement("span");
    value.className = "category-value";
    const amountText = document.createElement("strong");
    amountText.textContent = formatCurrency(amount);
    const percentageText = document.createElement("small");
    percentageText.textContent = `${percentage.toFixed(1)}%`;
    value.append(amountText, percentageText);
    row.append(badge, name, value);
    legendFragment.append(row);
  });

  elements.spectrum.replaceChildren(spectrumFragment);
  elements.categoryLegend.replaceChildren(legendFragment);
}

function renderCategoryFilter() {
  const categories = [...new Set(state.transactions.map(({ category }) => category))]
    .sort((left, right) => left.localeCompare(right));
  const selected = categories.includes(state.filters.category) ? state.filters.category : "all";
  const fragment = document.createDocumentFragment();
  fragment.append(createOption("all", "All categories"));
  categories.forEach((category) => fragment.append(createOption(category, category)));
  elements.filterCategory.replaceChildren(fragment);
  elements.filterCategory.value = selected;
  state.filters.category = selected;
}

function renderLedger() {
  const filtered = getFilteredTransactions();
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pagination.pageSize));
  state.pagination.page = Math.min(Math.max(1, state.pagination.page), pageCount);
  const start = (state.pagination.page - 1) * state.pagination.pageSize;
  const pageTransactions = filtered.slice(start, start + state.pagination.pageSize);
  const fragment = document.createDocumentFragment();
  pageTransactions.forEach((transaction) => fragment.append(createLedgerRow(transaction)));
  elements.tableBody.replaceChildren(fragment);

  elements.emptyState.classList.toggle("hidden", pageTransactions.length > 0);
  elements.emptyState.hidden = pageTransactions.length > 0;
  elements.emptyState.querySelector("strong").textContent = state.transactions.length === 0
    ? "Your ledger is ready"
    : "No activity matches";
  elements.emptyState.querySelector("p").textContent = state.transactions.length === 0
    ? "Add a transaction or import a CSV file to begin."
    : "Adjust your search or filters to reveal more activity.";

  elements.recordCounter.textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;
  const visibleNet = pageTransactions.reduce(
    (total, transaction) =>
      total + (transaction.type === "income" ? transaction.amountCents : -transaction.amountCents),
    0,
  );
  elements.visibleTotal.textContent = `Visible net: ${formatCurrency(visibleNet)}`;
  elements.previousPage.disabled = state.pagination.page === 1;
  elements.nextPage.disabled = state.pagination.page === pageCount;
  elements.pageStatus.textContent = `Page ${state.pagination.page} of ${pageCount}`;
}

function createLedgerRow(transaction) {
  const row = document.createElement("tr");
  row.dataset.transactionId = transaction.id;

  row.append(createCell(transaction.date, "transaction-date"));
  row.append(createCell(transaction.description, "transaction-description"));
  row.append(createCell(transaction.category, "transaction-category"));

  const typeCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `type-badge badge-${transaction.type}`;
  badge.textContent = capitalize(transaction.type);
  typeCell.append(badge);
  row.append(typeCell);

  const signedAmount = transaction.type === "income"
    ? transaction.amountCents
    : -transaction.amountCents;
  const amountCell = createCell(formatCurrency(signedAmount), "numeric transaction-amount");
  amountCell.dataset.type = transaction.type;
  row.append(amountCell);

  const actions = document.createElement("td");
  actions.className = "row-actions";
  actions.append(
    createActionButton("edit", `Edit ${transaction.description}`, editIcon()),
    createActionButton("delete", `Delete ${transaction.description}`, deleteIcon()),
  );
  row.append(actions);
  return row;
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function createActionButton(action, label, svgMarkup) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-action";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.innerHTML = svgMarkup;
  return button;
}

function getPeriodTransactions() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const startOfToday = new Date(currentYear, currentMonth, now.getDate());
  const thirtyDaysAgo = new Date(startOfToday);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  return state.transactions.filter(({ date }) => {
    const [year, month, day] = date.split("-").map(Number);
    if (state.timeframe === "month") {
      return year === currentYear && month - 1 === currentMonth;
    }
    if (state.timeframe === "ytd") {
      return year === currentYear;
    }
    const candidate = new Date(year, month - 1, day);
    return candidate >= thirtyDaysAgo && candidate <= now;
  });
}

function getFilteredTransactions() {
  const query = state.filters.query.toLocaleLowerCase();
  return state.transactions.filter((transaction) =>
    (state.filters.type === "all" || transaction.type === state.filters.type) &&
    (state.filters.category === "all" || transaction.category === state.filters.category) &&
    (query === "" ||
      transaction.description.toLocaleLowerCase().includes(query) ||
      transaction.category.toLocaleLowerCase().includes(query)),
  );
}

function handleSearch() {
  state.filters.query = elements.searchQuery.value.trim();
  state.pagination.page = 1;
  renderLedger();
}

function handleTimeframeChange() {
  state.timeframe = elements.timeframe.value;
  updateCalendarBadge();
  render();
}

function updateCalendarBadge() {
  const now = new Date();
  if (state.timeframe === "month") {
    elements.calendarText.textContent = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(now);
  } else if (state.timeframe === "30d") {
    elements.calendarText.textContent = "Rolling 30 days";
  } else {
    elements.calendarText.textContent = `${now.getFullYear()} YTD`;
  }
}

function handleRangeChange(event) {
  const button = event.target.closest("button[data-months]");
  if (!button) {
    return;
  }
  state.chartMonths = Number(button.dataset.months);
  elements.rangeTabs.querySelectorAll("button").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  scheduleChartRender();
}

function handleCompareToggle() {
  state.compareExpenses = !state.compareExpenses;
  elements.compareToggle.setAttribute("aria-pressed", String(state.compareExpenses));
  scheduleChartRender();
}

function handleTypeFilter(event) {
  state.filters.type = event.currentTarget.dataset.filterType;
  state.pagination.page = 1;
  document.querySelectorAll("[data-filter-type]").forEach((button) => {
    const active = button === event.currentTarget;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderLedger();
}

function handleLedgerFilter() {
  state.filters.category = elements.filterCategory.value;
  state.pagination.page = 1;
  renderLedger();
}

function handlePageSizeChange() {
  const pageSize = Number(elements.pageSize.value);
  state.pagination.pageSize = [10, 25, 50].includes(pageSize) ? pageSize : 10;
  state.pagination.page = 1;
  renderLedger();
}

function changePage(direction) {
  state.pagination.page += direction;
  renderLedger();
}

function handleLedgerAction(event) {
  const button = event.target.closest("button[data-action]");
  const row = button?.closest("tr[data-transaction-id]");
  const transaction = state.transactions.find(({ id }) => id === row?.dataset.transactionId);
  if (!button || !transaction) {
    return;
  }
  if (button.dataset.action === "edit") {
    openTransactionModal(transaction, button);
  } else {
    commitTransactionAction(
      { type: "delete", id: transaction.id },
      `Removed “${transaction.description}”.`,
    );
  }
}

function handleFabClick() {
  if (elements.modal.hidden) {
    openTransactionModal();
  } else {
    closeTransactionModal();
  }
}

function openTransactionModal(transaction = null, trigger = elements.fab) {
  modalTrigger = trigger;
  state.editingId = transaction?.id ?? null;
  elements.form.reset();
  clearAllErrors();
  elements.modalTitle.textContent = transaction ? "Edit transaction" : "Add transaction";
  const type = transaction?.type ?? "expense";
  elements.form.elements.namedItem("entryType").value = type;
  updateCategoryOptions(type, transaction?.category ?? "");
  elements.amount.value = transaction ? centsForInput(transaction.amountCents) : "";
  elements.date.value = transaction?.date ?? currentLocalISODate();
  elements.description.value = transaction?.description ?? "";
  elements.modal.hidden = false;
  elements.modal.classList.remove("hidden");
  elements.fab.classList.add("active");
  elements.fab.setAttribute("aria-expanded", "true");
  elements.fab.setAttribute("aria-label", "Close transaction dialog");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => elements.amount.focus());
}

function closeTransactionModal() {
  if (elements.modal.hidden) {
    return;
  }
  const editingId = state.editingId;
  elements.modal.hidden = true;
  elements.modal.classList.add("hidden");
  elements.fab.classList.remove("active");
  elements.fab.setAttribute("aria-expanded", "false");
  elements.fab.setAttribute("aria-label", "Add transaction");
  document.body.style.removeProperty("overflow");
  state.editingId = null;
  clearAllErrors();

  if (modalTrigger?.isConnected) {
    modalTrigger.focus();
  } else if (editingId) {
    const replacement = elements.tableBody.querySelector(
      `tr[data-transaction-id="${CSS.escape(editingId)}"] button[data-action="edit"]`,
    );
    (replacement ?? elements.fab).focus();
  } else {
    elements.fab.focus();
  }
}

function handleOverlayClick(event) {
  if (event.target === elements.modal) {
    closeTransactionModal();
  }
}

function handleModalKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeTransactionModal();
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const focusable = [...elements.modal.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function handleFormChange(event) {
  if (event.target.name === "entryType") {
    updateCategoryOptions(event.target.value);
    clearFieldError("type");
    clearFieldError("category");
  }
}

function handleFormSubmit(event) {
  event.preventDefault();
  const validation = validateTransaction(new FormData(elements.form));
  clearAllErrors();
  if (!validation.valid) {
    Object.entries(validation.errors).forEach(([field, message]) => setFieldError(field, message));
    validation.firstInvalid?.focus();
    return;
  }

  const existing = state.transactions.find(({ id }) => id === state.editingId);
  const transaction = {
    id: existing?.id ?? generateUUID(),
    ...validation.value,
  };
  commitTransactionAction(
    existing ? { type: "edit", transaction } : { type: "add", transaction },
    existing ? "Transaction updated." : "Transaction added.",
  );
  closeTransactionModal();
}

function validateTransaction(formData) {
  const errors = {};
  const type = String(formData.get("entryType") ?? "");
  const category = String(formData.get("category") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  let amountCents = 0;

  if (!new Set(["income", "expense"]).has(type)) {
    errors.type = "Choose income or expense.";
  }
  try {
    amountCents = toCents(String(formData.get("amount") ?? "").trim());
    if (amountCents <= 0) {
      errors.amount = "Enter an amount greater than $0.00.";
    }
  } catch {
    errors.amount = "Enter a valid monetary amount.";
  }
  if (!category) {
    errors.category = "Choose a category.";
  }
  if (!isValidISODate(date)) {
    errors.date = "Enter a valid date.";
  }
  if (!description) {
    errors.desc = "Enter a description.";
  }

  const order = [
    ["type", elements.form.querySelector('input[name="entryType"]')],
    ["amount", elements.amount],
    ["category", elements.category],
    ["date", elements.date],
    ["desc", elements.description],
  ];
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstInvalid: order.find(([field]) => errors[field])?.[1] ?? null,
    value: { type, amountCents, category, date, description },
  };
}

function setFieldError(field, message) {
  byId(`${field}Error`).textContent = message;
  fieldControls(field).forEach((control) => control.setAttribute("aria-invalid", "true"));
}

function clearFieldError(field) {
  byId(`${field}Error`).textContent = "";
  fieldControls(field).forEach((control) => control.removeAttribute("aria-invalid"));
}

function clearErrorOnInput(event) {
  const fields = { entryType: "type", amount: "amount", category: "category", date: "date", description: "desc" };
  if (fields[event.target.name]) {
    clearFieldError(fields[event.target.name]);
  }
}

function clearAllErrors() {
  ["type", "amount", "category", "date", "desc"].forEach(clearFieldError);
}

function fieldControls(field) {
  if (field === "type") {
    return [...elements.form.querySelectorAll('input[name="entryType"]')];
  }
  return [{ amount: elements.amount, category: elements.category, date: elements.date, desc: elements.description }[field]];
}

function updateCategoryOptions(type, selected = "") {
  const defaults = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const existing = state.transactions
    .filter((transaction) => transaction.type === type)
    .map((transaction) => transaction.category);
  const categories = [...new Set([...defaults, ...existing, selected].filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const fragment = document.createDocumentFragment();
  fragment.append(createOption("", "Select a category"));
  categories.forEach((category) => fragment.append(createOption(category, category)));
  elements.category.replaceChildren(fragment);
  elements.category.value = selected;
}

async function importTransactions() {
  const [file] = elements.importInput.files;
  if (!file) {
    return;
  }
  try {
    const imported = parseCSV(await file.text()).map((transaction) => ({
      ...transaction,
      id: generateUUID(),
    }));
    commitTransactionAction(
      { type: "import", transactions: imported },
      `Imported ${imported.length} ${imported.length === 1 ? "transaction" : "transactions"}.`,
    );
  } catch (error) {
    showToast(`Import failed: ${error.message}`, "error");
  } finally {
    elements.importInput.value = "";
  }
}

function exportTransactions() {
  try {
    const csv = serializeToCSV(state.transactions);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spendikkoo-${currentLocalISODate()}.csv`;
    link.className = "visually-hidden";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`Exported ${state.transactions.length} records.`, "success");
  } catch (error) {
    showToast(`Export failed: ${error.message}`, "error");
  }
}

function scheduleChartRender(metrics = computeFinancialMetrics(getPeriodTransactions())) {
  cancelAnimationFrame(chartFrame);
  chartFrame = requestAnimationFrame(() => {
    const trends = metrics.monthlyTrends.slice(-state.chartMonths);
    drawTrajectoryChart(trends);
    drawSparkline(elements.inflowSparkline, trends.map(({ incomeCents }) => incomeCents), "--inflow-mint");
    drawSparkline(elements.outflowSparkline, trends.map(({ expenseCents }) => expenseCents), "--outflow-rose");
  });
}

function drawTrajectoryChart(trends) {
  const { context, width, height } = prepareCanvas(elements.trajectoryCanvas);
  const theme = chartTheme();
  context.clearRect(0, 0, width, height);
  chartHitRegions = [];
  if (trends.length === 0) {
    drawEmptyChart(context, width, height, "Your trajectory will appear here", theme.muted);
    elements.trajectoryDescription.textContent = "No monthly cashflow data is available.";
    return;
  }

  const margins = { top: 18, right: 12, bottom: 36, left: width < 500 ? 42 : 58 };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const maximum = Math.max(1, ...trends.flatMap(({ incomeCents, expenseCents }) => [incomeCents, expenseCents]));
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

  context.font = "10px system-ui, sans-serif";
  for (let line = 0; line <= 4; line += 1) {
    const y = margins.top + (plotHeight * line) / 4;
    context.beginPath();
    context.moveTo(margins.left, y);
    context.lineTo(width - margins.right, y);
    context.strokeStyle = theme.border;
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = theme.muted;
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(`$${compact.format((maximum * (1 - line / 4)) / 100)}`, margins.left - 7, y);
  }

  const groupWidth = plotWidth / trends.length;
  const barWidth = Math.max(7, Math.min(22, groupWidth * (state.compareExpenses ? 0.25 : 0.38)));
  trends.forEach((bucket, index) => {
    const centerX = margins.left + groupWidth * index + groupWidth / 2;
    const baseY = margins.top + plotHeight;
    const incomeHeight = (bucket.incomeCents / maximum) * plotHeight;
    const expenseHeight = (bucket.expenseCents / maximum) * plotHeight;

    context.fillStyle = theme.track;
    context.fillRect(centerX - groupWidth * 0.3, margins.top, groupWidth * 0.6, plotHeight);
    context.fillStyle = theme.income;
    context.fillRect(
      centerX - (state.compareExpenses ? barWidth + 2 : barWidth / 2),
      baseY - incomeHeight,
      barWidth,
      incomeHeight,
    );
    if (state.compareExpenses) {
      context.fillStyle = theme.expense;
      context.fillRect(centerX + 2, baseY - expenseHeight, barWidth, expenseHeight);
    }

    context.fillStyle = theme.muted;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(formatMonth(bucket.month), centerX, baseY + 10);
    chartHitRegions.push({ centerX, groupWidth, bucket });
  });

  elements.trajectoryDescription.textContent = trends.map(({ month, incomeCents, expenseCents }) =>
    `${month}: income ${formatCurrency(incomeCents)}, expenses ${formatCurrency(expenseCents)}`,
  ).join("; ");
}

function drawSparkline(canvas, values, colorToken) {
  const { context, width, height } = prepareCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const color = getComputedStyle(document.documentElement).getPropertyValue(colorToken).trim();
  const data = values.length >= 2 ? values : [0, values[0] ?? 0, values[0] ?? 0];
  const maximum = Math.max(1, ...data);
  const minimum = Math.min(...data);
  const range = Math.max(1, maximum - minimum);
  context.beginPath();
  data.forEach((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - 5 - ((value - minimum) / range) * (height - 10);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${color}40`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fill();
}

function handleChartPointerMove(event) {
  if (chartHitRegions.length === 0) {
    return;
  }
  const rectangle = elements.trajectoryCanvas.getBoundingClientRect();
  const x = event.clientX - rectangle.left;
  const region = chartHitRegions.find(({ centerX, groupWidth }) =>
    Math.abs(x - centerX) <= groupWidth / 2,
  );
  if (!region) {
    hideChartTooltip();
    return;
  }
  elements.tooltip.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = formatMonthLong(region.bucket.month);
  const income = document.createElement("span");
  income.textContent = `Inflow · ${formatCurrency(region.bucket.incomeCents)}`;
  const expense = document.createElement("span");
  expense.textContent = `Outflow · ${formatCurrency(region.bucket.expenseCents)}`;
  elements.tooltip.append(heading, income, document.createElement("br"), expense);
  elements.tooltip.style.left = `${region.centerX}px`;
  elements.tooltip.style.top = `${Math.max(70, event.clientY - rectangle.top)}px`;
  elements.tooltip.classList.remove("hidden");
  elements.tooltip.setAttribute("aria-hidden", "false");
}

function hideChartTooltip() {
  elements.tooltip.classList.add("hidden");
  elements.tooltip.setAttribute("aria-hidden", "true");
}

function prepareCanvas(canvas) {
  const rectangle = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rectangle.width));
  const height = Math.max(1, Math.round(rectangle.height));
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const renderWidth = Math.round(width * ratio);
  const renderHeight = Math.round(height * ratio);
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    muted: styles.getPropertyValue("--text-muted").trim(),
    border: styles.getPropertyValue("--border-subtle").trim(),
    track: styles.getPropertyValue("--surface-card-subtle").trim(),
    income: "#10b981",
    expense: "#f43f5e",
  };
}

function drawEmptyChart(context, width, height, message, color) {
  context.fillStyle = color;
  context.font = "500 12px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, width / 2, height / 2);
}

function observeCharts() {
  if ("ResizeObserver" in globalThis) {
    const observer = new ResizeObserver(() => scheduleChartRender());
    [elements.trajectoryCanvas, elements.inflowSparkline, elements.outflowSparkline]
      .forEach((canvas) => observer.observe(canvas));
  } else {
    window.addEventListener("resize", () => scheduleChartRender(), { passive: true });
  }
}

function initializeTheme() {
  const storedTheme = storage.getItem(THEME_KEY, null);
  const preferred = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(storedTheme === "dark" || storedTheme === "light" ? storedTheme : preferred);
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  storage.setItem(THEME_KEY, document.documentElement.dataset.theme);
  scheduleChartRender();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  elements.themeButton.setAttribute("aria-pressed", String(dark));
  elements.themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

function handleGlobalShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.searchQuery.focus();
  }
}

function showToast(message, tone) {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  elements.toastRack.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 300);
  }, tone === "error" ? 6000 : 3500);
}

function loadTransactions() {
  const stored = storage.getItem(TRANSACTIONS_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }
  const ids = new Set();
  const transactions = [];
  for (const candidate of stored) {
    try {
      const transaction = normalizeStoredTransaction(candidate);
      if (ids.has(transaction.id)) transaction.id = generateUUID();
      ids.add(transaction.id);
      transactions.push(transaction);
    } catch {}
  }
  return transactions;
}

function normalizeStoredTransaction(candidate) {
  const amountCents = Number(candidate?.amountCents);
  const type = candidate?.type;
  const category = String(candidate?.category ?? "").trim();
  const date = String(candidate?.date ?? "").trim();
  const description = String(candidate?.description ?? "").trim();
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !["income", "expense"].includes(type) ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !category ||
    !isValidISODate(date) ||
    !description
  ) {
    throw new TypeError("Invalid transaction record.");
  }
  return {
    id: String(candidate.id ?? "").trim() || generateUUID(),
    type,
    amountCents,
    category,
    date,
    description,
  };
}

function isValidISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function currentLocalISODate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function centsForInput(cents) {
  return (cents / 100).toFixed(2);
}

function formatMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function formatMonthLong(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function editIcon() {
  return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l3.5-.8L19 7.7a2 2 0 0 0-2.7-2.7L4.8 16.5Z"></path></svg>';
}

function deleteIcon() {
  return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 4h6l1 3H8Zm-3 3 1 13h10l1-13"></path></svg>';
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} was not found.`);
  return element;
}
