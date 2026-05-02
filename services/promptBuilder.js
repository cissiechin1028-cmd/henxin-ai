function buildPrompt({ input, userState }) {
  const scenario = userState.scenario || "normal";
  const inputType = userState.inputType || "unknown";
  const context = userState.context || {};

  return `
入力タイプ：
${inputType}

ユーザー入力：
${input}

シナリオ：
${scenario}

前回までの文脈：
・前回の入力タイプ：${context.lastInputType || "なし"}
・前回のシナリオ：${context.lastScenario || "なし"}
・前回の相手LINE：${context.lastPartnerMessage || "なし"}
・前回の状況説明：${context.lastSituation || "なし"}
・ユーザーの目的：${context.userGoal || "なし"}
・前回のアドバイス：${context.lastAdvice || "なし"}

【最重要ルール】
・入力タイプを最優先
・意味が曖昧でも必ず「状況」として解釈する
・判断に迷っても必ず結論を出す（止まらない）
・聞き返しは禁止
・仮定で答える

【感情強度】
弱：軽く
中：共感＋一文
強：受け止める
危険：距離を保つ

【返信生成】
・そのまま送れるLINE文
・AとBは必ず方向を変える
・A＝安全
・B＝少し踏み込む
・似るのは禁止

【関係の見立て（最重要）】
・最初に必ず書く
・ユーザーが気づいていない変化を含める
・説明だけは禁止

▼必須条件
・必ず「リスク or 後果」を含める
・「〜状態です」だけは禁止

▼トーン（毎回いずれか）
① 冷静：穏やかにリスクを示す  
② 強め：はっきりリスクを言う  
③ 余白：直接言い切らず気づかせる  

※同じ言い回し禁止

【出力形式】

【結論】
今は、〇〇の状態です。

---

送るなら👇

A（安全）
「〇〇」

B（少し攻める）
「〇〇」

---

⚠️ 注意
〇〇すると、〇〇になりやすいです。

---

※この先の流れと本音を見るには「続き」と送ってください

＝＝＝＝＝＝＝＝＝＝
【Proパート】

【本音】
相手は今、〇〇の可能性が高いです。

【この後どうする？】
・〇〇する
・〇〇はまだしない
・〇〇のタイミングで送る

【やりがちNG】
ここで〇〇すると、〇〇になりやすいです。
`;
}

function formatFreeReply(text) {
  if (!text) return "";
  const i = text.indexOf("＝＝＝＝＝＝＝＝＝＝");
  return i !== -1 ? text.slice(0, i).trim() : text.trim();
}

module.exports = { buildPrompt, formatFreeReply };
