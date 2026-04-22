// ===== userStore.js =====

const userMap = new Map();

// 初始化用户
function initUser(userId) {
  if (!userMap.has(userId)) {
    userMap.set(userId, {
      relationship: null, // 关系
      purpose: null,      // 目的
      history: [],        // 对话历史
      freeCount: 0,       // 免费次数
    });
  }
}

// 获取用户
function getUser(userId) {
  initUser(userId);
  return userMap.get(userId);
}

// 添加历史
function addHistory(userId, text) {
  initUser(userId);
  const user = userMap.get(userId);

  user.history.push(text);

  // 只保留最近10条
  if (user.history.length > 10) {
    user.history.shift();
  }
}

// 获取历史
function getHistory(userId) {
  initUser(userId);
  return userMap.get(userId).history;
}

// 免费次数 +1
function increaseFreeCount(userId) {
  initUser(userId);
  userMap.get(userId).freeCount += 1;
}

// 获取免费次数
function getFreeCount(userId) {
  initUser(userId);
  return userMap.get(userId).freeCount;
}

module.exports = {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
};
