const cases = require("../data/replyCases.json");

function scoreCase(input, item) {
  const text = String(input || "");
  let score = 0;

  for (const keyword of item.keywords || []) {
    if (text.includes(keyword)) {
      score += 2;
    }
  }

  return score;
}

function retrieveCases(input, limit = 3) {
  return cases
    .map((item) => ({
      ...item,
      score: scoreCase(input, item)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      category: item.category,
      user_input: item.user_input,
      free_reply: item.free_reply,
      style_note: item.style_note
    }));
}

module.exports = {
  retrieveCases
};
