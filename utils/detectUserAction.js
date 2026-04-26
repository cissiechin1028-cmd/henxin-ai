function detectUserAction(text) {
  // 1. ユーザーが送信済み
  if (/(送った|送りました|もう送った|送信した|送ってしまった)/.test(text)) {
    return "sent";
  }

  // 2. 相手から返信あり
  if (/(返事来た|返信来た|返ってきた|返信あった)/.test(text)) {
    return "replied";
  }

  // 3. 返信なし・既読無視
  if (/(返事来ない|返事が来ない|返信来ない|返信ない|既読無視|既読スルー|未読|まだ来ない)/.test(text)) {
    return "no_reply";
  }

  return "none";
}

module.exports = { detectUserAction };
