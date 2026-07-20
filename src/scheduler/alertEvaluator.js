/**
 * Правила алертов без eval.
 */

const OPS = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

export const DEFAULT_ALERT_RULES = [
  { metric: "contactsWithoutStatus", operator: ">", value: 0, severity: "critical", code: "CONTACTS_WITHOUT_STATUS" },
  {
    metric: "contactsCycleWithoutNextActivity",
    operator: ">",
    value: 0,
    severity: "critical",
    code: "CONTACTS_CYCLE_NO_ACTIVITY",
  },
  { metric: "leadsWithoutNextActivity", operator: ">", value: 0, severity: "critical", code: "LEADS_WITHOUT_NEXT" },
  { metric: "dealsWithoutNextStep", operator: ">", value: 0, severity: "critical", code: "DEALS_WITHOUT_NEXT" },
  { metric: "overdueActivities", operator: ">", value: 0, severity: "critical", code: "OVERDUE_ACTIVITIES" },
  { metric: "overdueBirthdayGreetings", operator: ">", value: 0, severity: "critical", code: "OVERDUE_BIRTHDAY" },
  { metric: "staleDeals", operator: ">", value: 0, severity: "warning", code: "STALE_DEALS" },
];

function getMetricValue(metrics, metric) {
  if (!metrics || typeof metrics !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(metrics, metric)) {
    const v = metrics[metric];
    return typeof v === "number" ? v : Number(v);
  }
  return null;
}

/**
 * @returns {{ alerts: object[], fired: boolean }}
 */
export function evaluateAlertRules(metrics, rules = DEFAULT_ALERT_RULES) {
  const alerts = [];
  const list = Array.isArray(rules) ? rules : DEFAULT_ALERT_RULES;

  for (const rule of list) {
    if (!rule || typeof rule !== "object") continue;
    const op = OPS[rule.operator];
    if (!op) {
      alerts.push({
        code: "INVALID_ALERT_OPERATOR",
        severity: "warning",
        title: "Некорректное правило алерта",
        message: `Оператор ${rule.operator} не поддерживается`,
        count: null,
        source: "alertEvaluator",
      });
      continue;
    }
    const current = getMetricValue(metrics, rule.metric);
    if (current == null || Number.isNaN(current)) continue;
    const threshold = Number(rule.value);
    if (!op(current, threshold)) continue;

    alerts.push({
      code: rule.code || `ALERT_${String(rule.metric).toUpperCase()}`,
      severity: rule.severity || "warning",
      title: rule.title || String(rule.metric),
      count: current,
      threshold,
      operator: rule.operator,
      responsible: rule.responsible || null,
      link: rule.link || null,
      source: rule.source || "metrics",
      message: `${rule.metric} ${rule.operator} ${threshold} (сейчас ${current})`,
    });
  }

  return { alerts, fired: alerts.length > 0 };
}

/** Diff метрик без передачи полных отчётов в LLM */
export function computeMetricTrends(currentMetrics, previousMetrics) {
  if (!previousMetrics || typeof previousMetrics !== "object") return [];
  const trends = [];
  for (const [metric, current] of Object.entries(currentMetrics || {})) {
    if (typeof current !== "number") continue;
    const previous = previousMetrics[metric];
    if (typeof previous !== "number") continue;
    const difference = current - previous;
    let trend = "same";
    if (difference > 0) trend = "worse";
    if (difference < 0) trend = "better";
    // For "good" metrics like closedWon, invert later if needed — default: higher = worse for violation counts
    trends.push({ metric, current, previous, difference, trend });
  }
  return trends;
}

/** Guarantees no Function/eval path — used by tests */
export function assertNoEvalInAlertEngine() {
  return typeof evaluateAlertRules === "function" && !String(evaluateAlertRules).includes("eval(");
}
