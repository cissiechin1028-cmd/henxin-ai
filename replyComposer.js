// replyComposer.js

function composeReply(baseReply, style) {
  const base = String(baseReply || "").trim();

  if (!base) {
    return "無理しないでね。落ち着いたらまた話そ😊";
  }

  switch (style) {
    case "soft":
      return soften(base);
    case "light":
      return makeLight(base);
    case "probe":
      return makeProbe(base);
    case "flirt":
      return makeFlirt(base);
    case "careful":
      return makeCareful(base);
    default:
      return base;
  }
}

function soften(text) {
  if (text.includes("😊")) return text;
  if (text.endsWith("ね")) return `${text}😊`;
  return `${text}😊`;
}

function makeLight(text) {
  if (text.includes("大丈夫")) return text;
  return `${text} 無理に返さなくて大丈夫だよ`;
}

function makeProbe(text) {
  if (text.includes("気になった")) return text;
  return `${text} ちょっと気になっただけだから、無理しないでね`;
}

function makeFlirt(text) {
  if (text.includes("😊")) return text;
  return `${text}😊`;
}

function makeCareful(text) {
  return text
    .replace("寂しい", "少し寂しい")
    .replace("話したい", "少しだけ話せたら嬉しい");
}

module.exports = composeReply;
