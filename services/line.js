const axios = require("axios");

async function replyMessage(replyToken, text) {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [
          {
            type: "text",
            text: String(text).slice(0, 4500)
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("LINE REPLY SUCCESS:", res.status);
  } catch (err) {
    console.error("LINE REPLY FAILED:", err.response?.data || err.message);
    throw err;
  }
}

async function replyButton(replyToken, text, buttonText, url) {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [
          {
            type: "text",
            text: String(text).slice(0, 4500)
          },
          {
            type: "template",
            altText: buttonText,
            template: {
              type: "buttons",
              text: "続きはこちらから確認できます。",
              actions: [
                {
                  type: "uri",
                  label: buttonText,
                  uri: url
                }
              ]
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("LINE BUTTON REPLY SUCCESS:", res.status);
  } catch (err) {
    console.error("LINE BUTTON REPLY FAILED:", err.response?.data || err.message);
    throw err;
  }
}

async function replyAgreementButton(replyToken) {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [
          {
            type: "text",
            text:
              "はじめまして、恋愛返信AIです😊\n\n" +
              "このAIは、LINEのやり取りや相談内容をもとに、\n" +
              "自然で好印象な返信文を提案するサービスです。\n\n" +
              "ご利用前に、以下の内容をご確認ください。\n\n" +
              "■ 利用規約\n" +
              "https://line-reply.site/terms.html\n\n" +
              "■ プライバシーポリシー\n" +
              "https://line-reply.site/privacy.html\n\n" +
              "■ 返金ポリシー\n" +
              "https://line-reply.site/refund.html\n\n" +
              "■ データ削除について\n" +
              "https://line-reply.site/data-deletion.html\n\n" +
              "18歳以上の方のみご利用いただけます。\n" +
              "相談内容は最大30日間保存されます。\n\n" +
              "内容をご確認のうえ、同意してサービスを開始してください。",
            previewUrl: false
          },
          {
            type: "template",
            altText: "同意して始める",
            template: {
              type: "buttons",
              text: "内容を確認後、同意して開始できます。",
              actions: [
                {
                  type: "postback",
                  label: "18歳以上で同意して始める",
                  data: "accept_terms",
                  displayText: "同意して始める"
                }
              ]
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("LINE AGREEMENT BUTTON SUCCESS:", res.status);
  } catch (err) {
    console.error(
      "LINE AGREEMENT BUTTON FAILED:",
      err.response?.data || err.message
    );
    throw err;
  }
}

module.exports = {
  replyMessage,
  replyButton,
  replyAgreementButton
};
