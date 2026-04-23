const userMap = new Map();

function initUser(userId) {
  if (!userMap.has(userId)) {
    userMap.set(userId, {
      relationship: null,
      purpose: null,
      style: "balance", // soft / balance / push
      history: [],
      freeCount: 0,
      lastUsedDate: null,
      isPaid: false,
    });
  }
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getUser(userId) {
  initUser(userId);
  const user = userMap.get(userId);

  const today = getToday();

  if (user.lastUsedDate !== today) {
    user.freeCount = 0;
    user.lastUsedDate = today;
  }

  return user;
}

function addHistory(userId, text) {
  const user = getUser(userId);

  user.history.push(text);

  if (user.history.length > 10) {
    user.history.shift();
  }
}

function getHistory(userId) {
  return getUser(userId).history;
}

function increaseFreeCount(userId) {
  const user = getUser(userId);
  user.freeCount += 1;
}

function getFreeCount(userId) {
  return getUser(userId).freeCount;
}

function setPaid(userId, value) {
  const user = getUser(userId);
  user.isPaid = value;
}

module.exports = {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
  setPaid,
};
