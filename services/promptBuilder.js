function removeEmoji(text = "") {
  return String(text || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "");
}

function removeEmojiInsideQuotes(text = "") {
  return String(text || "").replace(/「([^」]*)」/g, (match, inner) => {
    return `「${removeEmoji(inner).trim()}"`.replace(/"$/, "」");
  });
}

function formatFreeReply(text = "") {
  return removeEmojiInsideQuotes(
    String(text || "")
      .replace(/【[^】]+】/g, "")
      .replace(/結論[:：]/g, "")
      .replace(/理由[:：]/g, "")
      .replace(/判断[:：]/g, "")
      .replace(/送るLINE[:：]/g, "")
      .replace(/注意[:：]/g, "")
      .replace(/⚠️/g, "")
      .replace(/---/g, "")

      .replace(/Proでは[\s\S]*$/i, "")
      .replace(/PROでは[\s\S]*$/i, "")
      .replace(/プロ版では[\s\S]*$/i, "")
      .replace(/プレミアムでは[\s\S]*$/i, "")
      .replace(/有料版では[\s\S]*$/i, "")

      .replace(/この先は[\s\S]*$/i, "")
      .replace(/ここから先は[\s\S]*$/i, "")
      .replace(/本当に大事なのはここから[\s\S]*$/i, "")
      .replace(/詳しく見ると[\s\S]*$/i, "")
      .replace(/詳しく見ていくと[\s\S]*$/i, "")
      .replace(/さらに詳しく[\s\S]*$/i, "")
      .replace(/続きはこちら[\s\S]*$/i, "")

      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")

      .split("\n\n")
      .slice(0, 3)
      .join("\n\n")

      .split(/(?<=[。！？])/)
      .slice(0, 8)
      .join("")

      .trim()
  );
}

module.exports = {
  formatFreeReply
};
