// userStore.js

const users = {};

function getUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      usageCount: 0,
      criticalUsageCount: 0,
      scene: null,
      risk: null,
      action: null,
      plan: "free"
    };
  }

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

module.exports = {
  getUser,
  updateUser
};
