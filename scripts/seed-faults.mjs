import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "pricing.ts");
const logPath = path.join(root, "fault-log.md");
const baseline = readFileSync(sourcePath, "utf8");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const faults = [
  ["F01", "Return an unrounded line total", "return round2(unitPrice * quantity);", "return unitPrice * quantity;"],
  ["F02", "Allow quantity zero", "quantity < 1", "quantity < 0"],
  ["F03", "Sum raw unit price times quantity instead of validated rounded lines", "sum + lineTotal(item)", "sum + item.unitPrice * item.quantity"],
  ["F04", "Move the 1,000 EGP tier boundary above 1,000", "subtotalAmount >= 1000", "subtotalAmount > 1000"],
  ["F05", "Move the 500 EGP tier boundary above 500", "subtotalAmount >= 500", "subtotalAmount > 500"],
  ["F06", "Stop trimming coupon input", "code.trim().toUpperCase()", "code.toUpperCase()"],
  ["F07", "Lower the SAVE20 minimum subtotal to 700", "minimumSubtotal: 800", "minimumSubtotal: 700"],
  ["F08", "Apply the percentage coupon to the pre-tier subtotal", "applyCoupon(amountAfterTier, orderSubtotal, coupon)", "applyCoupon(orderSubtotal, orderSubtotal, coupon)"],
  ["F09", "Tax shipping as part of VAT", "const vat = round2(discountedAmount * config.vatRate);", "const vat = round2((discountedAmount + shippingFee(discountedAmount, items.length, config.freeShippingThreshold)) * config.vatRate);"],
  ["F10", "Use the VAT-inclusive amount for the free-shipping test", "shippingFee(discountedAmount, items.length, config.freeShippingThreshold)", "shippingFee(discountedAmount + vat, items.length, config.freeShippingThreshold)"],
  ["F11", "Resolve coupon lookup immediately without the catalog delay", "await new Promise<void>((resolve) => setTimeout(resolve, 50));", "await Promise.resolve();"],
];

function applyExactlyOnce(source, before, after, id) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${id}: expected exactly one source match for ${JSON.stringify(before)}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const results = [];
try {
  for (const [id, description, before, after] of faults) {
    const mutant = applyExactlyOnce(baseline, before, after, id);
    writeFileSync(sourcePath, mutant);
    const run = spawnSync(npm, ["test", "--", "--reporter=dot"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const failures = output
      .split(/\r?\n/)
      .filter((line) => /^\s*FAIL\s+tests\/|^\s*Test Files\s+\d+|^\s*Tests\s+\d+\s+failed/.test(line))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-8);
    const killed = run.status !== 0;
    results.push({ id, description, killed, failures, exitCode: run.status });
    writeFileSync(sourcePath, baseline);
    if (!killed) throw new Error(`${id} survived the suite; stopping mutation run.`);
    process.stdout.write(`${id}: KILLED (exit ${run.status}) — ${description}\n`);
  }
} finally {
  writeFileSync(sourcePath, baseline);
}

const lines = [
  "# Fault seeding log",
  "",
  "Each fault below was introduced alone in `src/pricing.ts`, followed by a full Vitest run, and then the baseline source was restored before the next fault.",
  "",
  "| ID | Seeded fault | Result | Evidence from run |",
  "|---|---|---|---|",
];
for (const result of results) {
  lines.push(`| ${result.id} | ${result.description} | ${result.killed ? "Killed" : "Survived"} (exit ${result.exitCode}) | ${result.failures.join("; ").replaceAll("|", "\\|") || "Vitest reported a failing test"} |`);
}
lines.push("", `Total: ${results.length} faults seeded; ${results.filter((result) => result.killed).length} killed.`, "");
writeFileSync(logPath, lines.join("\n"));
