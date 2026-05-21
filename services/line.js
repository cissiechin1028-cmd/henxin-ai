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
            type: "template",
            altText: "ご利用開始",
            template: {
              type: "buttons",
              title: "ご利用前の確認",
              text:
                "18歳以上の方向けです。\n" +
                "相談内容は最大30日間保存されます。\n" +
                "ご利用前に内容をご確認ください。",
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
