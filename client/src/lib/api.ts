export interface MonthContribution {
  name: string;
  multiplier: number;
}

export interface MonthView {
  month: number;
  weight: number;
  budget: number;
  overrideAmount: number | null;
  isPinned: boolean;
  carryIn: number;
  effectiveBudget: number;
  actualSpend: number;
  status: string;
  contributions: MonthContribution[];
}

export interface PlanView {
  id: string;
  year: number;
  envelope: number;
  savingsFloor: number;
  monthlyBase: number;
  totalWeight: number;
  rationale: string | null;
  months: MonthView[];
}

export interface FestivalView {
  id: string;
  name: string;
  month: number;
  multiplier: number;
  categoryAffinity: string[];
  region: string;
  enabled: boolean;
  note: string | null;
}

export interface ProfileView {
  monthlyTakeHome: number;
  savingsFloor: number;
  fixedCommitments: number;
  cityTier: string;
  householdSize: number;
}

export interface BootstrapResponse {
  year: number;
  profile: ProfileView | null;
  festivals: FestivalView[];
  plan: PlanView | null;
}

export interface MonthSummary {
  month: number;
  year: number;
  effectiveBudget: number;
  actualSpend: number;
  remaining: number;
  daysLeft: number;
  safeDailySpend: number;
  status: string;
  willBreach: boolean;
  toastLine: string;
}

export interface ExpenseView {
  id: string;
  amount: number;
  merchantRaw: string;
  merchantClean: string;
  category: string;
  source: string;
  occurredAt: string;
  note: string;
  aiConfidence: number | null;
  createdAt: string;
}

export interface AddExpenseResult {
  expense: ExpenseView;
  monthly: MonthSummary;
}

export interface DashboardResponse {
  plan: PlanView | null;
  monthly: MonthSummary;
  recent: ExpenseView[];
  categories: { name: string; total: number }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

export function getDashboard(year: number, month: number): Promise<DashboardResponse> {
  return request<DashboardResponse>(`/dashboard?year=${year}&month=${month}`);
}

export function getBootstrap(year?: number): Promise<BootstrapResponse> {
  return request<BootstrapResponse>(`/bootstrap${year ? `?year=${year}` : ''}`);
}

export function putOverrides(year: number, overrides: Record<number, number>): Promise<PlanView> {
  return request<PlanView>('/plan/overrides', {
    method: 'PUT',
    body: JSON.stringify({ year, overrides }),
  });
}

export function putFestivals(
  enabledIds: string[],
  year: number,
): Promise<{ changed: number; plan: PlanView | null }> {
  return request<{ changed: number; plan: PlanView | null }>(`/festivals?year=${year}`, {
    method: 'PUT',
    body: JSON.stringify({ enabledIds }),
  });
}
