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
              "下のリンクからご確認ください。\n\n" +
              "■ プライバシーポリシー\n" +
              "下のリンクからご確認ください。\n\n" +
              "■ 返金ポリシー\n" +
              "下のリンクからご確認ください。\n\n" +
              "■ データ削除について\n" +
              "下のリンクからご確認ください。\n\n" +
              "18歳以上の方のみご利用いただけます。\n" +
              "相談内容は最大30日間保存されます。\n\n" +
              "内容をご確認のうえ、同意してサービスを開始してください。"
          },
          {
            type: "template",
            altText: "ご利用規約",
            template: {
              type: "buttons",
              text: "各ポリシーはこちらから確認できます。",
              actions: [
                {
                  type: "uri",
                  label: "利用規約",
                  uri: "https://line-reply.site/terms.html"
                },
                {
                  type: "uri",
                  label: "プライバシーポリシー",
                  uri: "https://line-reply.site/privacy.html"
                },
                {
                  type: "uri",
                  label: "返金ポリシー",
                  uri: "https://line-reply.site/refund.html"
                }
              ]
            }
          },
          {
            type: "template",
            altText: "データ削除について",
            template: {
              type: "buttons",
              text: "データ削除方法はこちらから確認できます。",
              actions: [
                {
                  type: "uri",
                  label: "データ削除について",
                  uri: "https://line-reply.site/data-deletion.html"
                },
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
