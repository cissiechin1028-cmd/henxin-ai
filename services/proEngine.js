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

以下の見出しは使ってよい。

【相手の温度感】
【今送るべきか】
【ベストなタイミング】
【NG行動】
【送るLINE】
【次のステップ】

長すぎず、でも無料版より明らかに深くすること。
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

    return `【相手の温度感】
今は少し距離を置きたい気持ちが出やすい状態です。ただ、ここで焦らず余白を残せば、流れを戻せる可能性はあります。

【今送るべきか】
今すぐ何度も送るより、少し時間を置いた方が安全です。

【ベストなタイミング】
2〜3日ほど空けて、夜の落ち着いた時間帯が自然です。

【NG行動】
理由を問い詰めたり、長文で気持ちを伝えすぎると、相手がプレッシャーを感じやすくなります。

【送るLINE】
「無理しなくて大丈夫だよ。落ち着いたらまた話そう」

【次のステップ】
まずは相手が返しやすい空気を残して、次の反応を見てから動くのが安全です。`;
  }
}

module.exports = { generateProResponse };
