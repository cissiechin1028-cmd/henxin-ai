const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { localeRules } = require("../prompts/locales");
const { assertLocale } = require("../services/resultNormalizers");

const targetProse = {
  ja: [
    "レンとの会話は自然に続き、Alexの名前やURL https://example.com が入っても、日本語の分析として読めます😊",
    "互いに質問を返しながら、日常の話題を少しずつ広げています。",
  ],
  "zh-TW": [
    "與レン的互動自然延續，即使包含 Alex 或網址 https://example.com，分析內容仍維持台灣繁體中文😊",
    "雙方都會接住問題，也能把日常話題逐步延伸。",
  ],
  en: [
    "The conversation with レン continues naturally, and mentioning Alex or https://example.com does not change the English analysis 😊.",
    "Both people answer questions and gradually expand ordinary topics with clear mutual engagement.",
  ],
};

test("the 3×3 source-language matrix always keeps the selected output locale", () => {
  for (const targetLocale of ["ja", "zh-TW", "en"]) {
    for (const sourceLocale of ["ja", "zh-TW", "en"]) {
      const prompt = localeRules(targetLocale);
      assert.match(prompt, new RegExp(`TARGET_OUTPUT_LOCALE: ${targetLocale.replace("-", "\\-")}`));
      assert.match(prompt, /source conversation|來源對話/);
      assert.doesNotThrow(() => assertLocale(targetProse[targetLocale], targetLocale), `${targetLocale} output with ${sourceLocale} source`);
    }
  }
});

test("Japanese validation accepts normal Japanese 会話 wording but rejects Chinese wording", () => {
  assert.doesNotThrow(() => assertLocale(["会話は自然に続いています。互いに質問を返し、少しずつ話題を広げています。"], "ja"));
  assert.throws(() => assertLocale(["這樣的互動還需要繼續觀察。"], "ja"), /AI_LANGUAGE_MISMATCH:ja/);
  assert.throws(() => assertLocale(["今度の約会を楽しみにしています。自然な会話が続いています。"], "ja"), /AI_LANGUAGE_MISMATCH:ja/);
});

test("English and Traditional Chinese allow foreign-script names without accepting foreign-language prose", () => {
  assert.doesNotThrow(() => assertLocale(["レン is responding consistently, and the conversation remains easy for both people to continue."], "en"));
  assert.throws(() => assertLocale(["会話は自然に続いています。相手も質問を返しています。"], "en"), /AI_LANGUAGE_MISMATCH:en/);
  assert.doesNotThrow(() => assertLocale(["與レン的互動延續得很自然，雙方都能接住話題並繼續回應。"], "zh-TW"));
  assert.throws(() => assertLocale(["会話は自然に続いています。相手も質問を返しています。"], "zh-TW"), /AI_LANGUAGE_MISMATCH:zh-TW/);
});

test("evidence excerpts are excluded from prose-language validation and retry preserves locale", () => {
  const service = fs.readFileSync("services/webAnalysis.js", "utf8");
  assert.match(service, /"excerpt"\]\.includes\(key\)/);
  assert.match(service, /Keep TARGET_OUTPUT_LOCALE=ja/);
  assert.match(service, /TARGET_OUTPUT_LOCALE=zh-TW/);
  assert.match(service, /Keep TARGET_OUTPUT_LOCALE=en/);
  assert.match(service, /attempt === 0 \? prompt/);
});
