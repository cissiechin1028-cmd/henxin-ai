const userMap = new Map();

function initUser(userId) {
  if (!userMap.has(userId)) {
    userMap.set(userId, {
      relationship: null,
      purpose: null,
      history: [],
      freeCount: 0,
      lastUsedDate: null, // 👈 新增
    });
  }
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

// 获取用户（自动处理每日重置）
function getUser(userId) {
  initUser(userId);
  const user = userMap.get(userId);

  const today = getToday();

  if (user.lastUsedDate !== today) {
    user.freeCount = 0;        // 👈 重置次数
    user.lastUsedDate = today; // 👈 更新日期
  }

  return user;
}

// 添加历史
function addHistory(userId, text) {
  const user = getUser(userId);

  user.history.push(text);
  if (user.history.length > 10) {
    user.history.shift();
  }
}

// 获取历史
function getHistory(userId) {
  return getUser(userId).history;
}

// +1
function increaseFreeCount(userId) {
  const user = getUser(userId);
  user.freeCount += 1;
}

// 获取次数
function getFreeCount(userId) {
  return getUser(userId).freeCount;
}

module.exports = {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
};
