/**
 * Диагностический показатель качества ведения CRM (не KPI продаж).
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(part, total) {
  if (!total || total <= 0) return null;
  return (Number(part) || 0) / Number(total);
}

/**
 * @param {{
 *  contactsTotal?: number,
 *  contactsWithoutStatus?: number,
 *  leadsTotal?: number,
 *  leadsWithoutActivity?: number,
 *  dealsTotal?: number,
 *  dealsWithoutNextStep?: number,
 *  activitiesActive?: number,
 *  activitiesOverdue?: number,
 *  entitiesTotal?: number,
 *  entitiesStale?: number,
 * }} metrics
 */
export function calculateCrmQualityScore(metrics = {}) {
  const hasAnyBase =
    (metrics.contactsTotal || 0) +
      (metrics.leadsTotal || 0) +
      (metrics.dealsTotal || 0) +
      (metrics.activitiesActive || 0) +
      (metrics.activitiesOverdue || 0) >
    0;

  if (!hasAnyBase) {
    return {
      qualityScore: null,
      qualityBreakdown: {
        base: 100,
        note: "Недостаточно данных для расчёта качества ведения CRM.",
      },
    };
  }

  const breakdown = { base: 100 };
  let score = 100;

  const cPct = pct(metrics.contactsWithoutStatus, metrics.contactsTotal);
  if (cPct != null) {
    const penalty = Math.round(cPct * 100);
    breakdown.contactsWithoutStatusPenalty = penalty;
    score -= penalty;
  } else {
    breakdown.contactsWithoutStatusPenalty = 0;
  }

  const lPct = pct(metrics.leadsWithoutActivity, metrics.leadsTotal);
  if (lPct != null) {
    const penalty = Math.round(lPct * 100);
    breakdown.leadsWithoutActivityPenalty = penalty;
    score -= penalty;
  } else {
    breakdown.leadsWithoutActivityPenalty = 0;
  }

  const dPct = pct(metrics.dealsWithoutNextStep, metrics.dealsTotal);
  if (dPct != null) {
    const penalty = Math.round(dPct * 100);
    breakdown.dealsWithoutNextStepPenalty = penalty;
    score -= penalty;
  } else {
    breakdown.dealsWithoutNextStepPenalty = 0;
  }

  const actTotal = (metrics.activitiesActive || 0) + (metrics.activitiesOverdue || 0);
  const oPct = pct(metrics.activitiesOverdue, actTotal);
  if (oPct != null) {
    const penalty = Math.round(oPct * 100);
    breakdown.overdueActivitiesPenalty = penalty;
    score -= penalty;
  } else {
    breakdown.overdueActivitiesPenalty = 0;
  }

  const sPct = pct(metrics.entitiesStale, metrics.entitiesTotal);
  if (sPct != null) {
    const penalty = Math.round(sPct * 100);
    breakdown.staleEntitiesPenalty = penalty;
    score -= penalty;
  } else {
    breakdown.staleEntitiesPenalty = 0;
  }

  return {
    qualityScore: clamp(Math.round(score), 0, 100),
    qualityBreakdown: breakdown,
  };
}
