import assert from "node:assert/strict";
import { normalizeAiMarkdown } from "../app/static/ai-page.js";

const raw = [
  "A quick answer. --- ## 1. Savings snapshot",
  "Your current savings rate is 37.8%.",
  "\\[ \\text{Savings Rate} = \\frac{\\text{Income} - \\text{Expenses}}{\\text{Income}} \\times 100 \\]",
  "Current: \\((1,158,000 - 720,700) / 1,158,000 \\times 100 = 37.8\\%\\)",
  "Overview text. --- ## 1. Snapshot | Item | Amount (₹) | Comment | |---|---|---| || **Monthly income** | 1,158,000 | Salary |",
  "#### 2.1 A practical next step",
  "- Save ₹20,000 each month and keep unbudgeted values as —.",
].join("\n");

const normalized = normalizeAiMarkdown(raw);

assert.match(normalized, /A quick answer\.\n\n---\n\n## 1\. Savings snapshot/);
assert.match(normalized, /Savings Rate = \(Income - Expenses\) \/ \(Income\) × 100/);
assert.match(normalized, /Current: \(1,158,000 - 720,700\) \/ 1,158,000 × 100 = 37\.8%/);
assert.match(normalized, /\| Item \| Amount \(₹\) \| Comment \|\n\|---\|---\|---\|\n\*\*Monthly income\*\* \| 1,158,000 \| Salary \|/);
assert.match(normalized, /\n#### 2\.1 A practical next step/);
assert.match(normalized, /₹20,000/);
assert.match(normalized, /—/);
assert.doesNotMatch(normalized, /\\\\(?:text|frac|times|%|\[|\])/);

console.log("AI Markdown normalization checks passed.");