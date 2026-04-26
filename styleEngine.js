// styleEngine.js

function pickStyle({ scene, input = "" }) {
  const t = String(input || "");

  if (scene === "break") return "careful";
  if (scene === "ignore") return "light";
  if (scene === "cold") return "probe";
  if (scene === "like") return "flirt";

  if (
    t.includes("ごめん") ||
    t.includes("すみません") ||
    t.includes("忙しい") ||
    t.includes("余裕ない") ||
    t.includes("余裕がない") ||
    t.includes("大変")
  ) {
    return "soft";
  }

  return "natural";
}

function getStyleLabel(style) {
  const labels = {
    soft: "やさしく受け止める",
    light: "重く見せない",
    probe: "温度を探る",
    flirt: "少し距離を縮める",
    careful: "追いすぎない",
    natural: "自然に返す"
  };

  return labels[style] || "自然に返す";
}

module.exports = {
  pickStyle,
  getStyleLabel
};
