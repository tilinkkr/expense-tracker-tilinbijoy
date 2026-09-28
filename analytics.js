const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const TRANSACTION_TYPES = new Set(["income", "expense"]);
const CSV_COLUMNS = ["id", "type", "amount", "category", "date", "description"];
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

let fallbackUuidCounter = 0;

export function toCents(amount) {
  if (typeof amount === "bigint") {
    const cents = amount * 100n;
    return safeBigIntToNumber(cents, "Amount exceeds the supported range.");
  }

  if (typeof amount !== "number" && typeof amount !== "string") {
    throw new TypeError("Amount must be a number, string, or bigint.");
  }

  const normalized = String(amount).trim();
  const match = normalized.match(
    /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/,
  );

  if (!match) {
    throw new TypeError("Amount must be a finite decimal value.");
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const integerPart = match[2] ?? "0";
  const fractionPart = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new RangeError("Amount exponent exceeds the supported range.");
  }

  const digits = BigInt(`${integerPart}${fractionPart}`);
  const decimalShift = exponent - fractionPart.length + 2;
  let absoluteCents;

  if (decimalShift >= 0) {
    absoluteCents = digits * 10n ** BigInt(decimalShift);
  } else {
    const divisor = 10n ** BigInt(-decimalShift);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    absoluteCents = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }

  return safeBigIntToNumber(sign * absoluteCents, "Amount exceeds the supported range.");
}

export function fromCents(cents) {
  assertCents(cents);
  return cents / 100;
}

export function formatCurrency(cents) {
  assertCents(cents);
  return CURRENCY_FORMATTER.format(fromCents(cents));
}

export function computeFinancialMetrics(transactions) {
  if (!Array.isArray(transactions)) {
    throw new TypeError("Transactions must be an array.");
  }

  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  const categorySpendMap = new Map();
  const monthlyBucketMap = new Map();

  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    const type = normalizeType(transaction?.type, index);
    const amountCents = transactionAmountInCents(transaction, index);
    const month = transactionMonth(transaction?.date, index);

    if (type === "income") {
      totalIncomeCents = safeAdd(totalIncomeCents, amountCents);
    } else {
      totalExpenseCents = safeAdd(totalExpenseCents, amountCents);
      const category = normalizeRequiredText(transaction?.category, "category", index);
      categorySpendMap.set(
        category,
        safeAdd(categorySpendMap.get(category) ?? 0, amountCents),
      );
    }

    let bucket = monthlyBucketMap.get(month);
    if (!bucket) {
      bucket = { month, incomeCents: 0, expenseCents: 0, balanceCents: 0 };
      monthlyBucketMap.set(month, bucket);
    }

    if (type === "income") {
      bucket.incomeCents = safeAdd(bucket.incomeCents, amountCents);
      bucket.balanceCents = safeAdd(bucket.balanceCents, amountCents);
    } else {
      bucket.expenseCents = safeAdd(bucket.expenseCents, amountCents);
      bucket.balanceCents = safeAdd(bucket.balanceCents, -amountCents);
    }
  }

  const balanceCents = safeAdd(totalIncomeCents, -totalExpenseCents);
  const savingsRate =
    totalIncomeCents === 0 ? 0 : (balanceCents / totalIncomeCents) * 100;
  const orderedMonths = radixSortMonthKeys([...monthlyBucketMap.keys()]);
  const monthlyTrends = orderedMonths.map((month) => monthlyBucketMap.get(month));

  return {
    totalIncomeCents,
    totalExpenseCents,
    balanceCents,
    savingsRate,
    categorySpendMap,
    monthlyTrends,
  };
}

export function serializeToCSV(transactions) {
  if (!Array.isArray(transactions)) {
    throw new TypeError("Transactions must be an array.");
  }

  const rows = [CSV_COLUMNS];

  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = normalizeTransaction(transactions[index], index);
    rows.push([
      transaction.id,
      transaction.type,
      centsToDecimal(transaction.amountCents),
      transaction.category,
      transaction.date,
      transaction.description,
    ]);
  }

  return rows.map((row) => row.map(escapeCSVField).join(",")).join("\r\n");
}

export function parseCSV(csvText) {
  if (typeof csvText !== "string") {
    throw new TypeError("CSV input must be a string.");
  }

  const rows = tokenizeCSV(csvText.replace(/^\uFEFF/, ""));
  if (rows.length === 0 || rows.every((row) => row.every((field) => field === ""))) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) {
    throw new TypeError("CSV header contains duplicate columns.");
  }

  const positions = new Map(headers.map((header, index) => [header, index]));
  const amountHeader = positions.has("amount") ? "amount" : "amountcents";
  const requiredHeaders = ["type", amountHeader, "category", "date", "description"];
  const missingHeaders = requiredHeaders.filter((header) => !positions.has(header));

  if (missingHeaders.length > 0) {
    throw new TypeError(`CSV is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const transactions = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.every((field) => field.trim() === "")) {
      continue;
    }

    if (row.length > headers.length) {
      throw new TypeError(`CSV row ${rowIndex + 1} has more fields than the header.`);
    }

    const value = (column) => row[positions.get(column)] ?? "";
    let amountCents;

    if (amountHeader === "amountcents") {
      const rawCents = value("amountcents").trim();
      if (!/^[+-]?\d+$/.test(rawCents)) {
        throw new TypeError(`Transaction at CSV row ${rowIndex + 1} has invalid cents.`);
      }
      amountCents = Number(rawCents);
    } else {
      try {
        amountCents = toCents(value("amount"));
      } catch (error) {
        throw new TypeError(
          `Transaction at CSV row ${rowIndex + 1} has an invalid amount: ${error.message}`,
        );
      }
    }

    const candidate = {
      id: positions.has("id") ? value("id").trim() : "",
      type: value("type").trim().toLowerCase(),
      amountCents,
      category: value("category").trim(),
      date: value("date").trim(),
      description: value("description").trim(),
    };

    transactions.push(normalizeTransaction(candidate, rowIndex, true));
  }

  return transactions;
}

export function generateUUID() {
  const runtimeCrypto = globalThis.crypto;

  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    fillFallbackRandomBytes(bytes);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function normalizeTransaction(transaction, index, indexIsCsvRow = false) {
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw transactionError(index, indexIsCsvRow, "must be an object");
  }

  const type = normalizeType(transaction.type, index, indexIsCsvRow);
  const amountCents = transactionAmountInCents(transaction, index, indexIsCsvRow);
  if (amountCents <= 0) {
    throw transactionError(index, indexIsCsvRow, "must have an amount greater than zero");
  }

  const category = normalizeRequiredText(
    transaction.category,
    "category",
    index,
    indexIsCsvRow,
  );
  const description = normalizeRequiredText(
    transaction.description,
    "description",
    index,
    indexIsCsvRow,
  );
  const date = normalizeISODate(transaction.date, index, indexIsCsvRow);
  const id = String(transaction.id ?? "").trim() || generateUUID();

  return { id, type, amountCents, category, date, description };
}

function normalizeType(type, index, indexIsCsvRow = false) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (!TRANSACTION_TYPES.has(normalized)) {
    throw transactionError(index, indexIsCsvRow, 'must have type "income" or "expense"');
  }
  return normalized;
}

function transactionAmountInCents(transaction, index, indexIsCsvRow = false) {
  let cents;

  if (transaction && Object.hasOwn(transaction, "amountCents")) {
    cents = transaction.amountCents;
  } else if (transaction && Object.hasOwn(transaction, "amount")) {
    try {
      cents = toCents(transaction.amount);
    } catch (error) {
      throw transactionError(index, indexIsCsvRow, `has an invalid amount: ${error.message}`);
    }
  } else {
    throw transactionError(index, indexIsCsvRow, "is missing an amount");
  }

  try {
    assertCents(cents);
  } catch (error) {
    throw transactionError(index, indexIsCsvRow, `has invalid cents: ${error.message}`);
  }

  if (cents < 0) {
    throw transactionError(index, indexIsCsvRow, "cannot have a negative amount");
  }

  return cents;
}

function normalizeRequiredText(value, field, index, indexIsCsvRow = false) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw transactionError(index, indexIsCsvRow, `is missing ${field}`);
  }
  return normalized;
}

function normalizeISODate(value, index, indexIsCsvRow = false) {
  const date = String(value ?? "").trim();
  const match = date.match(ISO_DATE_PATTERN);

  if (!match) {
    throw transactionError(index, indexIsCsvRow, "must use an ISO date in YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw transactionError(index, indexIsCsvRow, "contains an invalid calendar date");
  }

  return date;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function transactionMonth(value, index) {
  return normalizeISODate(value, index).slice(0, 7);
}

function transactionError(index, indexIsCsvRow, detail) {
  const location = indexIsCsvRow ? `CSV row ${index + 1}` : `index ${index}`;
  return new TypeError(`Transaction at ${location} ${detail}.`);
}

function assertCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError("Cents must be a safe integer.");
  }
}

function safeBigIntToNumber(value, message) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(message);
  }
  return number;
}

function safeAdd(left, right) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Financial total exceeds the supported range.");
  }
  return total;
}

function centsToDecimal(cents) {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function escapeCSVField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function tokenizeCSV(csvText) {
  if (csvText === "") {
    return [];
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];

    if (inQuotes) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        closedQuote = false;
      } else if (character === "\r" || character === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        closedQuote = false;
        if (character === "\r" && csvText[index + 1] === "\n") {
          index += 1;
        }
      } else if (character !== " " && character !== "\t") {
        throw new TypeError(`Unexpected character after a closing quote at position ${index}.`);
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new TypeError(`Unexpected quote in an unquoted field at position ${index}.`);
      }
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && csvText[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new TypeError("CSV contains an unterminated quoted field.");
  }

  if (field !== "" || row.length > 0 || !/[\r\n]$/.test(csvText)) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function radixSortMonthKeys(keys) {
  let sorted = keys;

  for (let position = 6; position >= 0; position -= 1) {
    if (position === 4) {
      continue;
    }

    const buckets = Array.from({ length: 10 }, () => []);
    for (const key of sorted) {
      buckets[key.charCodeAt(position) - 48].push(key);
    }
    sorted = buckets.flat();
  }

  return sorted;
}

function fillFallbackRandomBytes(bytes) {
  fallbackUuidCounter = (fallbackUuidCounter + 1) >>> 0;
  let state = (Date.now() ^ fallbackUuidCounter ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = (state + Math.floor(Math.random() * 256)) & 0xff;
  }
}
