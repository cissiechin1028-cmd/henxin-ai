// decisionEngine.js

function decisionEngine({ scene, risk, action, plan = "free" }) {
  let conclusion = "";
  let reason = "";
  let recommendedAction = "";
  let tone = "";
  let sendTiming = "";
  let proStrategy = "";

  if (risk === "critical" || scene === "break") {
    conclusion = "今は感情的に追いかけすぎない方が安全です";
    reason = "別れや復縁に近い場面では、強く迫るほど相手が引きやすくなります";
    recommendedAction = "短く、責めずに、話す余地だけ残す";
    tone = "落ち着いた・重くしすぎない";
    sendTiming = "すぐ連投せず、少し時間を置いてから";
    proStrategy = "相手に決断を迫らず、“一度だけ話したい”という形にするのが安全です";
  } else if (scene === "ignore" || risk === "high") {
    conclusion = "今は軽く気遣う返信が安全です";
    reason = "既読無視の場面で追いLINEすると、重い印象になりやすいです";
    recommendedAction = "相手を責めず、返事の負担を下げる";
    tone = "軽い・優しい・余白あり";
    sendTiming = "最後の送信から半日〜1日空けるのが無難";
    proStrategy = "返信を催促せず、“返さなくても大丈夫”という空気を出すと再開しやすくなります";
  } else if (scene === "cold" || risk === "medium") {
    conclusion = "今は相手の温度を確認しながら進めるのが安全です";
    reason = "冷たい返信に対して踏み込みすぎると、さらに距離ができます";
    recommendedAction = "軽く気遣い、相手の状態を探る";
    tone = "やわらかい・確認する・責めない";
    sendTiming = "すぐ送ってもOK。ただし長文は避ける";
    proStrategy = "不安をぶつけるより、“少し気になった”くらいの軽さが安全です";
  } else if (scene === "explain") {
    conclusion = "今は理解を見せる返信が安全です";
    reason = "相手が忙しさを説明している場合、責めずに受け止める方が印象が良いです";
    recommendedAction = "感謝と気遣いを短く返す";
    tone = "安心感・余裕・優しさ";
    sendTiming = "すぐ返信してOK";
    proStrategy = "“忙しい中返してくれたこと”に反応すると、相手の負担を下げられます";
  } else if (scene === "like") {
    conclusion = "今は少し好意を見せても大丈夫です";
    reason = "好感がある場面では、軽い好意表現が関係を進めやすくします";
    recommendedAction = "重くならない程度に好意を出す";
    tone = "自然・少し甘い・軽め";
    sendTiming = "会話の流れがあるうちに送るのが良い";
    proStrategy = "“好き”を直接言うより、“話していて楽しい”の方が安全に距離を縮められます";
  } else {
    conclusion = "今は自然に短く返すのが安全です";
    reason = "状況が強く悪いわけではないため、重く考えすぎない方が自然です";
    recommendedAction = "短く自然に返す";
    tone = "自然・軽い・やさしい";
    sendTiming = "自然なタイミングでOK";
    proStrategy = "無理に駆け引きせず、会話を続けやすい余白を残すのが安全です";
  }

  const result = {
    conclusion,
    action: recommendedAction,
    tone
  };

  if (plan === "premium" || plan === "pro") {
    result.reason = reason;
    result.sendTiming = sendTiming;
  }

  if (plan === "pro") {
    result.proStrategy = proStrategy;
  }

  return result;
}

module.exports = decisionEngine;
