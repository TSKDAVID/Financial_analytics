import { clamp } from './stats';

export interface HealthInput {
  monthlyIncome: number; monthlyExpenses: number; monthlyDebtPayments: number;
  liquidSavings: number; /** coefficient of variation of monthly net cash flow */ netVolatility: number;
}
export interface HealthResult {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  savingsRate: number; dti: number; emergencyMonths: number;
  breakdown: { key: 'savings' | 'debt' | 'emergency' | 'stability'; score: number; max: number; value: number }[];
}

/** 0-100 score: savings 30, debt 25, emergency fund 25, stability 20. */
export function healthScore(i: HealthInput): HealthResult {
  const savingsRate = i.monthlyIncome > 0 ? (i.monthlyIncome - i.monthlyExpenses) / i.monthlyIncome : i.monthlyExpenses > 0 ? -1 : 0;
  const dti = i.monthlyIncome > 0 ? i.monthlyDebtPayments / i.monthlyIncome : i.monthlyDebtPayments > 0 ? 1 : 0;
  const emergencyMonths = i.monthlyExpenses > 0 ? i.liquidSavings / i.monthlyExpenses : i.liquidSavings > 0 ? 24 : 0;
  const sSav = 30 * clamp(savingsRate / 0.2, 0, 1); // 20%+ savings = full
  const sDebt = 25 * (dti <= 0.1 ? 1 : clamp(1 - (dti - 0.1) / 0.4, 0, 1)); // 50%+ DTI = 0
  const sEmg = 25 * clamp(emergencyMonths / 6, 0, 1); // 6 months = full
  const sStab = 20 * clamp(1 - i.netVolatility, 0, 1);
  const score = Math.round(sSav + sDebt + sEmg + sStab);
  const grade = score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'fair' : score >= 30 ? 'poor' : 'critical';
  return {
    score, grade, savingsRate, dti, emergencyMonths,
    breakdown: [
      { key: 'savings', score: Math.round(sSav), max: 30, value: savingsRate },
      { key: 'debt', score: Math.round(sDebt), max: 25, value: dti },
      { key: 'emergency', score: Math.round(sEmg), max: 25, value: emergencyMonths },
      { key: 'stability', score: Math.round(sStab), max: 20, value: i.netVolatility },
    ],
  };
}

export function dtiLevel(dti: number): 'ok' | 'warning' | 'danger' {
  return dti >= 0.43 ? 'danger' : dti >= 0.36 ? 'warning' : 'ok';
}

/** Months savings last with zero income. */
export function stressTest(savings: number, monthlyEssential: number, monthlyDebt: number, months = 24) {
  const burn = monthlyEssential + monthlyDebt;
  const runwayMonths = burn > 0 ? savings / burn : Infinity;
  const series: { month: number; balance: number }[] = [];
  let b = savings;
  for (let m = 0; m <= months; m++) { series.push({ month: m, balance: Math.round(b) }); b -= burn; }
  return { runwayMonths, burn, series };
}
