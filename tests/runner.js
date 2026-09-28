"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { performance } = require("node:perf_hooks");

const tests = [];
let analytics;

function test(suite, name, execute) {
  tests.push({ suite, name, execute });
}

async function loadAnalytics() {
  const modulePath = resolve(__dirname, "..", "analytics.js");
  const source = readFileSync(modulePath, "utf8");
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function transaction(overrides = {}) {
  return {
    id: "transaction-1",
    type: "expense",
    amountCents: 100,
    category: "Food",
    date: "2026-09-28",
    description: "Lunch",
    ...overrides,
  };
}

function registerNumericalTests() {
  test("Numerical Correctness & Edge Cases", "preserves integer-cent precision", () => {
    assert.equal(analytics.toCents(0.1 + 0.2), 30);
    assert.equal(analytics.fromCents(30), 0.3);
    assert.equal(analytics.formatCurrency(30), "$0.30");
    assert.equal(analytics.toCents("1.005"), 101);
    assert.equal(analytics.toCents(19.994), 1999);
    assert.equal(analytics.toCents(19.995), 2000);
    assert.equal(analytics.toCents("999999.999"), 100000000);
  });

  test("Numerical Correctness & Edge Cases", "handles an empty transaction list", () => {
    const metrics = analytics.computeFinancialMetrics([]);
    assert.equal(metrics.totalIncomeCents, 0);
    assert.equal(metrics.totalExpenseCents, 0);
    assert.equal(metrics.balanceCents, 0);
    assert.equal(metrics.savingsRate, 0);
    assert.deepEqual([...metrics.categorySpendMap], []);
    assert.deepEqual(metrics.monthlyTrends, []);
  });

  test("Numerical Correctness & Edge Cases", "handles zero and negative balances", () => {
    const balanced = analytics.computeFinancialMetrics([
      transaction({ id: "income", type: "income", amountCents: 2500, category: "Salary" }),
      transaction({ id: "expense", amountCents: 2500 }),
    ]);
    assert.equal(balanced.balanceCents, 0);
    assert.equal(balanced.savingsRate, 0);

    const deficit = analytics.computeFinancialMetrics([
      transaction({ id: "income", type: "income", amountCents: 1000, category: "Salary" }),
      transaction({ id: "expense", amountCents: 1750 }),
    ]);
    assert.equal(deficit.balanceCents, -750);
    assert.equal(deficit.savingsRate, -75);
    assert.equal(analytics.toCents(-0.1 - 0.2), -30);
    assert.equal(analytics.formatCurrency(-30), "-$0.30");
  });

  test("Numerical Correctness & Edge Cases", "rejects invalid monetary boundaries", () => {
    assert.throws(() => analytics.toCents(Number.POSITIVE_INFINITY), TypeError);
    assert.throws(
      () => analytics.computeFinancialMetrics([transaction({ amountCents: -1 })]),
      /negative amount/,
    );
    assert.throws(() => analytics.fromCents(1.5), /safe integer/);
  });

  test("Numerical Correctness & Edge Cases", "orders monthly buckets chronologically", () => {
    const metrics = analytics.computeFinancialMetrics([
      transaction({ id: "march", date: "2026-03-10" }),
      transaction({ id: "january", date: "2026-01-10" }),
      transaction({ id: "december", date: "2025-12-10" }),
    ]);
    assert.deepEqual(
      metrics.monthlyTrends.map(({ month }) => month),
      ["2025-12", "2026-01", "2026-03"],
    );
  });
}

function registerIdentifierTests() {
  test("Identifier Integrity", "generates 2,000 collision-free RFC 4122 v4 identifiers", () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids = new Set();
    for (let index = 0; index < 2_000; index += 1) {
      const id = analytics.generateUUID();
      assert.match(id, pattern);
      ids.add(id);
    }
    assert.equal(ids.size, 2_000);
  });

  test("Identifier Integrity", "uses the UUID fallback without crypto.randomUUID", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: undefined,
      });
      const id = analytics.generateUUID();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "crypto", descriptor);
      } else {
        delete globalThis.crypto;
      }
    }
  });
}

function registerCSVTests() {
  test("CSV Serialization Integrity", "round-trips RFC 4180 special characters", () => {
    const records = [
      transaction({
        id: "csv-1",
        amountCents: 1299,
        category: "Dining, Cafés",
        description: 'Lunch at "North"\nSecond floor',
      }),
      transaction({
        id: "csv-2",
        type: "income",
        amountCents: 275050,
        category: "Client Work",
        date: "2026-09-29",
        description: "Milestone 1\r\nMilestone 2",
      }),
    ];

    const csv = analytics.serializeToCSV(records);
    assert.ok(csv.startsWith("id,type,amount,category,date,description\r\n"));
    assert.ok(csv.includes('"Dining, Cafés"'));
    assert.ok(csv.includes('"Lunch at ""North""\nSecond floor"'));
    assert.deepEqual(analytics.parseCSV(csv), records);
  });

  test("CSV Serialization Integrity", "parses reordered headers and quoted commas", () => {
    const csv = [
      "description,date,category,amount,type,id",
      '"Hardware, adapters",2026-09-28,Equipment,49.95,expense,reordered-1',
    ].join("\r\n");

    assert.deepEqual(analytics.parseCSV(csv), [
      transaction({
        id: "reordered-1",
        amountCents: 4995,
        category: "Equipment",
        description: "Hardware, adapters",
      }),
    ]);
  });

  test("CSV Serialization Integrity", "rejects malformed or incomplete CSV", () => {
    assert.throws(
      () => analytics.parseCSV("type,amount,date,description\r\nexpense,1.00,2026-09-28,Lunch"),
      /missing required columns/i,
    );
    assert.throws(
      () => analytics.parseCSV('type,amount,category,date,description\r\nexpense,1.00,Food,2026-09-28,"Lunch'),
      /unterminated quoted field/i,
    );
    assert.throws(
      () => analytics.parseCSV("type,amount,category,date,description\r\nexpense,1.00,Food,2026-02-30,Lunch"),
      /invalid calendar date/i,
    );
  });
}

function registerStressBenchmark() {
  test("High-Throughput Stress Benchmark", "aggregates 50,000 records in under 25ms", () => {
    const recordCount = 50_000;
    const categories = ["Housing", "Food", "Transport", "Utilities", "Healthcare"];
    const records = new Array(recordCount);
    let expectedIncome = 0;
    let expectedExpenses = 0;

    for (let index = 0; index < recordCount; index += 1) {
      const type = index % 3 === 0 ? "income" : "expense";
      const amountCents = (index % 997) + 1;
      if (type === "income") {
        expectedIncome += amountCents;
      } else {
        expectedExpenses += amountCents;
      }

      records[index] = {
        id: `stress-${index}`,
        type,
        amountCents,
        category: categories[index % categories.length],
        date: `${2020 + (index % 7)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
        description: `Synthetic transaction ${index}`,
      };
    }

    analytics.computeFinancialMetrics(records);
    analytics.computeFinancialMetrics(records);

    const startedAt = performance.now();
    const metrics = analytics.computeFinancialMetrics(records);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(metrics.totalIncomeCents, expectedIncome);
    assert.equal(metrics.totalExpenseCents, expectedExpenses);
    assert.equal(metrics.balanceCents, expectedIncome - expectedExpenses);
    assert.equal(metrics.categorySpendMap.size, categories.length);
    assert.ok(
      elapsedMs < 25,
      `Expected aggregation under 25ms, measured ${elapsedMs.toFixed(3)}ms.`,
    );

    return { elapsedMs, recordCount };
  });

  test("High-Throughput Stress Benchmark", "serializes 10,000 CSV records in under 40ms", () => {
    const recordCount = 10_000;
    const records = new Array(recordCount);
    for (let index = 0; index < recordCount; index += 1) {
      records[index] = transaction({
        id: `csv-stress-${index}`,
        type: index % 3 === 0 ? "income" : "expense",
        amountCents: (index % 10_000) + 1,
        category: index % 2 === 0 ? "Food, Dining" : "Salary",
        description: `Synthetic "CSV" row ${index}\nline two`,
      });
    }

    analytics.serializeToCSV(records);
    const startedAt = performance.now();
    const csv = analytics.serializeToCSV(records);
    const elapsedMs = performance.now() - startedAt;

    assert.ok(csv.startsWith("id,type,amount,category,date,description\r\n"));
    assert.equal(csv.split("\r\n").length, recordCount + 1);
    assert.ok(
      elapsedMs < 40,
      `Expected CSV serialization under 40ms, measured ${elapsedMs.toFixed(3)}ms.`,
    );
    return { elapsedMs, recordCount };
  });
}

async function run() {
  try {
    analytics = await loadAnalytics();
    const stressOnly = process.argv.includes("--stress-only");
    const unitOnly = process.argv.includes("--unit-only");
    if (!stressOnly) {
      registerNumericalTests();
      registerCSVTests();
      registerIdentifierTests();
    }
    if (!unitOnly) {
      registerStressBenchmark();
    }

    let passed = 0;
    let failed = 0;
    let currentSuite = "";

    for (const testCase of tests) {
      if (testCase.suite !== currentSuite) {
        currentSuite = testCase.suite;
        process.stdout.write(`\n${currentSuite}\n`);
      }

      try {
        const result = await testCase.execute();
        const benchmark = result?.elapsedMs === undefined
          ? ""
          : ` (${result.recordCount.toLocaleString("en-US")} records in ${result.elapsedMs.toFixed(3)}ms)`;
        process.stdout.write(`  PASS ${testCase.name}${benchmark}\n`);
        passed += 1;
      } catch (error) {
        process.stderr.write(`  FAIL ${testCase.name}\n`);
        process.stderr.write(`       ${error.stack ?? error.message}\n`);
        failed += 1;
      }
    }

    const total = passed + failed;
    const passRate = total === 0 ? 0 : (passed / total) * 100;
    process.stdout.write(
      `\nResult: ${passed}/${total} passed (${passRate.toFixed(1)}%).\n`,
    );
    process.exit(failed === 0 && passRate === 100 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`Test runner initialization failed: ${error.stack ?? error.message}\n`);
    process.exit(1);
  }
}

run();
