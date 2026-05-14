const axios = require("axios");

function buildProPrompt({ input, scenario = "normal" }) {
  return `
ユーザー入力：
${input}

シナリオ：
${scenario}

あなたは恋愛LINE相談の有料版AIです。
無料版よりも深く、次にどう動くべきかを具体的に判断してください。

【絶対ルール】
・日本語のみ
・中国語は禁止
・断定しすぎない
・不安を煽りすぎない
・でも曖昧に逃げない
・ユーザーに考えさせない
・質問で返さない
・A/B案は禁止
・送るLINEは1つだけ
・固定テンプレートっぽくしすぎない
・自然な日本語で書く
・LINEで読みやすい長さにする
・各項目は2〜3行以内
・全体は長くしすぎない
・絵文字は各見出しに1つ程度だけ使う
・重く見えすぎる表現は避ける
・専門家っぽさより「落ち着いて整理してくれる感じ」を優先する

【Proで必ず含める内容】

1. 相手の温度感
相手が今どんな心理状態に近いかを、現実的に判断する。

2. 今送るべきか
今すぐ送るべきか、待つべきかを明確にする。

3. 最適なタイミング
何時間後、何日後、夜、返信が来てから、など具体的に出す。

4. やってはいけないNG行動
追いLINE、確認、長文、謝罪の重ねすぎ、疑いをぶつける等から状況に合うものを出す。

5. そのまま送れるLINE
相手にそのまま送れる一言を1つだけ出す。
必ず「」で囲む。

6. 次のステップ
送った後、または待った後にどう動くかを短く示す。

【出力形式】

🌡️【相手の温度感】
📩【今送るべきか】
⏰【ベストなタイミング】
⚠️【NG行動】
💬【送るLINE】
🪄【次のステップ】

【長さルール】
・各見出しの本文は短く
・箇条書きは多くても3つまで
・1つの説明を長文にしない
・全体でスマホ画面2〜3スクロール以内に収める
・無料版より深いが、読み疲れしない長さにする
`;
}

async function generateProResponse(input, scenario = "normal") {
  const prompt = buildProPrompt({ input, scenario });

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは恋愛LINE返信の有料版専門家です。
返信内容だけでなく、相手の温度感、送るタイミング、NG行動、次の動きまで判断します。
専門家らしさよりも、ユーザーの気持ちを整理しながら、落ち着いて具体的に導くことを重視してください。
出力はLINEで読みやすい長さにまとめてください。
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 900
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("PRO OPENAI ERROR:", err.response?.data || err.message);

    return `🌡️【相手の温度感】
今は少し距離を置きたい気持ちが出やすい時期です。
ただ、焦らず余白を残せば流れが戻る可能性もあります。

📩【今送るべきか】
今は何度も送らず、少し時間を置く方が安全です。

⏰【ベストなタイミング】
2〜3日ほど空けて、夜の落ち着いた時間帯が自然です。

⚠️【NG行動】
追いLINEや長文、気持ちを問い詰めるような連絡は逆効果になりやすいです。

💬【送るLINE】
「無理しなくて大丈夫だよ。落ち着いたらまた話そう」

🪄【次のステップ】
まずは相手が返しやすい空気を残し、次の反応を見てから動くのが安全です。`;
  }
}

module.exports = { generateProResponse };
