const users = {};

function createUser() {
  return {
    usageCount: 0,
    replyUsageCount: 0,
    criticalUsageCount: 0,
    plan: "free",

    pendingClarify: false,
    pendingText: null,

    lastInput: null,
    lastInputType: null,
    lastScenario: null,
    lastAdvice: null,
    lastRiskLevel: 1
  };
}

function getUser(userId) {
  if (!users[userId]) {
    users[userId] = createUser();
  }

  return users[userId];
}

function resetUser(userId) {
  users[userId] = createUser();
  return users[userId];
}

function updateUser(userId, data = {}) {
  const current = getUser(userId);

  users[userId] = {
    ...current,
    ...data
  };

  return users[userId];
}

function incrementReplyUsage(userId) {
  const user = getUser(userId);

  users[userId] = {
    ...user,
    usageCount: user.usageCount + 1,
    replyUsageCount: user.replyUsageCount + 1
  };

  return users[userId];
}

function incrementCriticalUsage(userId) {
  const user = getUser(userId);

  users[userId] = {
    ...user,
    criticalUsageCount: user.criticalUsageCount + 1
  };

  return users[userId];
}

module.exports = {
  getUser,
  resetUser,
  updateUser,
  incrementReplyUsage,
  incrementCriticalUsage
};
