const WINDOW_VERSION = "recent_context_v1";
const RECENT_MESSAGE_LIMIT = 120;
const BASELINE_MESSAGE_LIMIT = 30;
const RECENT_DAY_WINDOW = 30;

function parsedTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function evenlySample(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => items[Math.floor(index * items.length / limit)]);
}

function selectAnalysisWindow(messages = []) {
  const valid = messages.filter(item => ["self", "partner"].includes(item?.sender) && String(item?.text || "").trim()).slice(-500);
  const dated = valid.map(item => parsedTime(item.timestamp)).filter(value => value !== null);
  const latestTimestamp = dated.length ? Math.max(...dated) : null;
  const threshold = latestTimestamp === null ? null : latestTimestamp - RECENT_DAY_WINDOW * 86400000;
  const withinDays = threshold === null ? [] : valid.filter(item => {
    const time = parsedTime(item.timestamp);
    return time !== null && time >= threshold;
  });
  const recent = (withinDays.length >= 12 ? withinDays : valid.slice(-RECENT_MESSAGE_LIMIT)).slice(-RECENT_MESSAGE_LIMIT);
  const recentSet = new Set(recent);
  const baseline = evenlySample(valid.filter(item => !recentSet.has(item)), BASELINE_MESSAGE_LIMIT);
  return {
    recent,
    baseline,
    metadata: {
      window_version: WINDOW_VERSION,
      strategy: withinDays.length >= 12 ? "latest_30_days_capped_120_plus_baseline" : "latest_120_messages_plus_baseline",
      recent_weight: 0.8,
      baseline_weight: 0.2,
      recent_message_count: recent.length,
      baseline_message_count: baseline.length,
      total_valid_message_count: valid.length,
      timestamp_coverage: valid.length ? dated.length / valid.length : 0,
      latest_message_at: latestTimestamp === null ? null : new Date(latestTimestamp).toISOString(),
      degraded: recent.length < 12,
    },
  };
}

module.exports = { WINDOW_VERSION, RECENT_MESSAGE_LIMIT, BASELINE_MESSAGE_LIMIT, RECENT_DAY_WINDOW, selectAnalysisWindow };
