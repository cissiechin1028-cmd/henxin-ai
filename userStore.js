const users = {};

function getUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      userId,
      history: [],
      relationship: "不明",
      purpose: "不明",
      isPaid: false,
      plan: "free",
      usageCount: 0,
      criticalUsageCount: 0,
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
  return getUser(userId).history || [];
}

function setPaid(userId, value) {
  getUser(userId).isPaid = value;
}

function setPlan(userId, plan) {
  const user = getUser(userId);

  if (!["free", "premium", "pro"].includes(plan)) {
    user.plan = "free";
    user.isPaid = false;
    return;
  }

  user.plan = plan;
  user.isPaid = plan !== "free";
}

function incrementUsage(userId) {
  const user = getUser(userId);
  user.usageCount = (user.usageCount || 0) + 1;
}

function incrementCriticalUsage(userId) {
  const user = getUser(userId);
  user.criticalUsageCount = (user.criticalUsageCount || 0) + 1;
}

function resetUser(userId) {
  users[userId] = {
    userId,
    history: [],
    relationship: "不明",
    purpose: "不明",
    isPaid: false,
    plan: "free",
    usageCount: 0,
    criticalUsageCount: 0,
  };
}

module.exports = {
  getUser,
  addHistory,
  getHistory,
  setPaid,
  setPlan,
  incrementUsage,
  incrementCriticalUsage,
  resetUser,
};
