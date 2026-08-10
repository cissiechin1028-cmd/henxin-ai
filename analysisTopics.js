const topics = [
  ["interest", "脈あり診断", "相手は今、恋愛として好意を持ってる？", ["positive_signals", "concern_signals", "decision_factors", "next_step"], ["relationship_stage", "evidence"], "恋愛好意を支える行動と、単なる親しさを区別する。"],
  ["true-feelings", "相手の本音", "あの返信の裏で、本当はどう思ってる？", ["surface_attitude", "possible_feelings", "evidence", "next_step"], ["decision_factors", "missing_evidence"], "表面行動と推測される感情を分離し、私的な本音を断定しない。"],
  ["seriousness", "本気度診断", "相手はどれくらい本気？遊びじゃなく真剣？", ["investment", "consistency", "evidence", "next_step"], ["future_factors", "concern_signals"], "言葉より時間・労力・約束の実行など継続的な投資を重視する。"],
  ["confession-timing", "告白タイミング診断", "今、告白して大丈夫？まだ早い？", ["checklist", "missing_evidence", "scenario_risk", "next_step"], ["positive_signals", "concern_signals"], "好意だけでなく、受け入れ準備と圧力になる危険を両方評価する。"],
  ["stalled-relationship", "関係が進まない理由", "いい感じなのに、なぜ関係が進まない？", ["relationship_stage", "cause_ranking", "decision_factors", "next_step"], ["conflict_cause", "missing_evidence"], "期間が短ければ停滞と断定せず、進めない状態と進めたくない意思を区別する。"],
  ["slower-replies", "返信が遅くなった理由", "前より返信が遅いのは、気持ちが変わったから？", ["before_after", "cause_ranking", "reply_context", "next_step"], ["concern_signals", "missing_evidence"], "以前と最近の可視時刻がなければ遅くなったと主張しない。"],
  ["colder-tone", "そっけなくなった理由", "急にそっけなくなったのは、何が原因？", ["before_after", "cause_ranking", "concern_signals", "next_step"], ["conflict_cause", "missing_evidence"], "前後比較がなければ現在の会話が冷たく見える理由だけを扱う。"],
  ["read-no-reply", "既読スルー理由診断", "既読無視されたのは、忙しいだけ？それとも脈なし？", ["reply_context", "cause_ranking", "positive_signals", "concern_signals", "next_step"], ["scenario_risk", "before_after"], "最後が自分の発言で、既読表示と経過時間が確認できる場合だけ既読スルーとして扱う。"],
  ["distance", "距離感診断", "今の距離感は近すぎる？引いたほうがいい？", ["distance_balance", "investment", "scenario_risk", "next_step"], ["future_factors"], "連絡量だけでなく、双方の主導性と反応を比較する。"],
  ["misalignment", "すれ違い分析", "なんで気持ちがすれ違う？どこでズレた？", ["intent_reception", "conflict_cause", "decision_factors", "next_step"], ["missing_evidence"], "相手の受け取り方は推測として表示し、確認できない心理を事実にしない。"],
  ["argument", "ケンカ原因分析", "今回のケンカ、本当の原因は何？", ["conflict_cause", "intent_reception", "decision_factors", "next_step"], ["before_after", "missing_evidence"], "表面的なきっかけと、会話で支持される争点を分ける。"],
  ["apology", "謝るべきか診断", "今は謝るべき？それとも言わないほうがいい？", ["responsibility", "evidence", "decision_factors", "next_step"], ["intent_reception"], "自分の責任と背負わなくてよい部分を必ず両方示す。"],
  ["wait", "時間を置くべきか診断", "今は連絡しないほうがいい？少し時間を置くべき？", ["scenario_risk", "concern_signals", "decision_factors", "next_step"], ["reply_context"], "機械的な日数を決めず、再接触できる観察条件を示す。"],
  ["reconciliation", "復縁診断", "復縁の可能性はある？今また動いていい？", ["conflict_cause", "positive_signals", "concern_signals", "relationship_stage", "next_step"], ["missing_evidence", "future_factors"], "別れた時期・切り出した側・理由・現在の連絡状況が不明なら補足を求める。"],
  ["compatibility", "相性診断", "ふたりは恋愛として相性がいい？合わない？", ["compatibility", "positive_signals", "concern_signals", "next_step"], ["future_factors", "missing_evidence"], "短い会話から長期的人格相性を判断せず、観察できる会話相性に限定する。"],
  ["future", "関係の将来性診断", "この関係、この先ちゃんと進展していく？", ["future_factors", "investment", "concern_signals", "next_step"], ["before_after", "missing_evidence"], "時間跨度が足りなければ未来予測をせず、現時点の関係状態として報告する。"],
].map(([id, title, question, requiredModules, optionalModules, evidenceInstruction]) =>
  Object.freeze({ id, title, question, requiredModules: Object.freeze(requiredModules), optionalModules: Object.freeze(optionalModules), evidenceInstruction })
);

const ANALYSIS_TOPICS = Object.freeze(topics);
const ANALYSIS_TOPIC_BY_ID = Object.freeze(Object.fromEntries(topics.map((topic) => [topic.id, topic])));

function getAnalysisTopic(topicId) {
  return ANALYSIS_TOPIC_BY_ID[String(topicId || "").trim()] || null;
}

module.exports = { ANALYSIS_TOPICS, ANALYSIS_TOPIC_BY_ID, getAnalysisTopic };
