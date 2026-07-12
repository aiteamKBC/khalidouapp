import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1'

export type ApiEnvelope<T> = {
  success: boolean
  data: T
  meta: Record<string, unknown>
}

export type AdminMe = {
  id: string
  company_id: string
  name: string
  email: string
  role: string
  status: string
}

export type Summary = {
  total_employees: number
  online_employees: number
  idle_employees: number
  offline_employees: number
  total_hours_today: number
  screenshots_today: number
}

export type Team = {
  id: string
  name: string
  description: string | null
  status: string
}

export type Employee = {
  id: string
  name: string
  email: string
  employee_code: string
  department: string | null
  timezone: string
  status: string
}

export type Screenshot = {
  id: string
  employee_id: string
  session_id: string
  captured_at: string
  width: number
  height: number
  status: string
  temporary_url: string
}

export type TimesheetRow = {
  employee_id: string
  employee_name: string
  date: string
  total_tracked_seconds: number
  active_seconds: number
  idle_seconds: number
  screenshot_count: number
}

export type ReportRow = {
  employee_id: string
  name: string
  email: string
  active_seconds: number
  idle_seconds: number
  total_seconds: number
}

export type TrackingSettings = {
  screenshot_enabled: boolean
  screenshot_interval_minutes: number
  idle_threshold_minutes: number
  capture_during_idle: boolean
  offline_threshold_minutes: number
  screenshot_retention_days: number
}

export const api = axios.create({
  baseURL: API_BASE_URL,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('khaliduo_access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>) {
  const response = await promise
  return response.data.data
}

export const client = {
  apiBaseUrl: API_BASE_URL,
  async login(email: string, password: string) {
    return unwrap<{ access_token: string; refresh_token: string }>(
      api.post('/auth/login', { email, password }),
    )
  },
  me: () => unwrap<AdminMe>(api.get('/auth/me')),
  summary: (teamId?: string) =>
    unwrap<Summary>(api.get('/dashboard/summary', { params: teamId ? { team_id: teamId } : {} })),
  teams: () => unwrap<Team[]>(api.get('/teams')),
  createTeam: (payload: { name: string; description?: string }) => unwrap<Team>(api.post('/teams', payload)),
  teamMembers: (teamId: string) => unwrap<Employee[]>(api.get(`/teams/${teamId}/members`)),
  addTeamMember: (teamId: string, employeeId: string) =>
    unwrap(api.post(`/teams/${teamId}/members`, { employee_id: employeeId })),
  removeTeamMember: (teamId: string, employeeId: string) =>
    unwrap(api.delete(`/teams/${teamId}/members/${employeeId}`)),
  employees: (teamId?: string) =>
    unwrap<Employee[]>(api.get('/employees', { params: teamId ? { team_id: teamId } : {} })),
  screenshots: (teamId?: string) =>
    unwrap<Screenshot[]>(api.get('/screenshots', { params: teamId ? { team_id: teamId } : {} })),
  timesheetsDaily: (teamId?: string) =>
    unwrap<TimesheetRow[]>(api.get('/timesheets/daily', { params: teamId ? { team_id: teamId } : {} })),
  reportsSummary: (teamId?: string) =>
    unwrap<{ total_tracked_seconds: number; screenshots: number }>(
      api.get('/reports/summary', { params: teamId ? { team_id: teamId } : {} }),
    ),
  reportsEmployees: (teamId?: string) =>
    unwrap<ReportRow[]>(api.get('/reports/employees', { params: teamId ? { team_id: teamId } : {} })),
  trackingSettings: () => unwrap<TrackingSettings>(api.get('/settings/tracking')),
  updateTrackingSettings: (payload: Partial<TrackingSettings>) =>
    unwrap<TrackingSettings>(api.patch('/settings/tracking', payload)),
}
