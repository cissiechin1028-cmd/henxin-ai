const axios = require("axios");

function buildQuickReply() {
  return {
    items: [
      {
        type: "action",
        action: {
          type: "message",
          label: "返信アドバイス",
          text: "返信アドバイス"
        }
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "相手の本音",
          text: "相手の本音"
        }
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "状況相談",
          text: "状況相談"
        }
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "リセット",
          text: "リセット"
        }
      }
    ]
  };
}

async function downloadLineImage(messageId) {
  try {
    const res = await axios.get(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        responseType: "arraybuffer",
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        }
      }
    );

    return Buffer.from(res.data);
  } catch (err) {
    console.error("LINE IMAGE DOWNLOAD FAILED:", err.response?.data || err.message);
    throw err;
  }
}

async function replyMessage(replyToken, text, options = {}) {
  try {
    const message = {
      type: "text",
      text: String(text).slice(0, 4500)
    };

    const res = await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [message]
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
              text: "Proでは、返信相談を何度でも続けられます。",
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
              "はじめまして、返信くんです😊\n\n" +
              "LINEのやり取りや恋愛相談をもとに、自然な返信を一緒に考えるAIです。\n\n" +
              "ご利用前に以下をご確認ください。\n\n" +
              "■ 利用規約\n" +
              "https://line-reply.site/terms.html\n\n" +
              "■ プライバシーポリシー\n" +
              "https://line-reply.site/privacy.html\n\n" +
              "18歳以上の方のみご利用いただけます。\n" +
              "相談内容は最大30日間保存されます。\n\n" +
              "個人情報は削除したうえでお送りください。\n\n" +
              "内容をご確認のうえ、同意して開始してください。",
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
  replyAgreementButton,
  downloadLineImage
};
