const users = {};

function getUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      userId,
      history: [],
      relationship: "不明",
      purpose: "不明",
      isPaid: false,
      plan: "free", // free / premium / pro
      usageCount: 0,
    };
  }

  return users[userId];
}

function addHistory(userId, message) {
  const user = getUser(userId);
  user.history.push(message);

  if (user.history.length > 20) {
    user.history = user.history.slice(-20);
  }
}

function getHistory(userId) {
  const user = getUser(userId);
  return user.history || [];
}

function setPaid(userId, value) {
  const user = getUser(userId);
  user.isPaid = value;
}

function setPlan(userId, plan) {
  const user = getUser(userId);

  if (!["free", "premium", "pro"].includes(plan)) {
    user.plan = "free";
    return;
  }

  user.plan = plan;
  user.isPaid = plan !== "free";
}

function incrementUsage(userId) {
  const user = getUser(userId);
  user.usageCount = (user.usageCount || 0) + 1;
}

module.exports = {
  getUser,
  addHistory,
  getHistory,
  setPaid,
  setPlan,
  incrementUsage,
};
