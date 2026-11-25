import assert from "node:assert/strict";
import { readableApiError } from "../app/static/ai-page.js";

assert.equal(
  readableApiError([
    {
      type: "value_error",
      loc: ["body", "question"],
      msg: "Value error, Please enter a message.",
      input: "   ",
    },
  ]),
  "Value error, Please enter a message.",
);

assert.equal(
  readableApiError({ detail: [{ msg: "Question is required." }] }),
  "Question is required.",
);

assert.equal(
  readableApiError({ message: "The AI provider is unavailable." }),
  "The AI provider is unavailable.",
);

assert.equal(
  readableApiError({ unexpected: { nested: true } }),
  "AI is unavailable. Please retry shortly.",
);

assert.equal(
  readableApiError("[object Object]"),
  "AI is unavailable. Please retry shortly.",
);

process.stdout.write("Chat error formatting checks passed.\n");
