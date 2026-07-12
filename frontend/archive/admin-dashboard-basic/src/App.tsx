import {
  BarChart3,
  Camera,
  Check,
  Clock,
  LayoutDashboard,
  LogOut,
  Monitor,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ElementType, FormEvent, ReactNode } from 'react'
import './App.css'
import { client } from './api'
import type { AdminMe, Employee, ReportRow, Screenshot, Summary, Team, TimesheetRow, TrackingSettings } from './api'

type View = 'overview' | 'teams' | 'employees' | 'screenshots' | 'timesheets' | 'reports' | 'settings'

const navItems: Array<{ id: View; label: string; icon: ElementType }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'teams', label: 'Teams', icon: Shield },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'screenshots', label: 'Screenshots', icon: Camera },
  { id: 'timesheets', label: 'Timesheets', icon: Clock },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function formatSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('khaliduo_access_token') ?? '')
  const [me, setMe] = useState<AdminMe | null>(null)
  const [view, setView] = useState<View>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [timesheets, setTimesheets] = useState<TimesheetRow[]>([])
  const [reportRows, setReportRows] = useState<ReportRow[]>([])
  const [reportSummary, setReportSummary] = useState<{ total_tracked_seconds: number; screenshots: number } | null>(null)
  const [trackingSettings, setTrackingSettings] = useState<TrackingSettings | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [teamMembers, setTeamMembers] = useState<Employee[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [memberEmployeeId, setMemberEmployeeId] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  )

  async function loadAll(nextTeamId = selectedTeamId) {
    setLoading(true)
    setError('')
    try {
      const [nextMe, nextTeams] = await Promise.all([client.me(), client.teams()])
      const effectiveTeamId = nextTeamId || ''
      const [nextSummary, nextEmployees, nextScreenshots, nextTimesheets, nextReportSummary, nextReportRows, nextSettings] =
        await Promise.all([
          client.summary(effectiveTeamId || undefined),
          client.employees(effectiveTeamId || undefined),
          client.screenshots(effectiveTeamId || undefined),
          client.timesheetsDaily(effectiveTeamId || undefined),
          client.reportsSummary(effectiveTeamId || undefined),
          client.reportsEmployees(effectiveTeamId || undefined),
          client.trackingSettings(),
        ])

      setMe(nextMe)
      setTeams(nextTeams)
      setSummary(nextSummary)
      setEmployees(nextEmployees)
      setScreenshots(nextScreenshots)
      setTimesheets(nextTimesheets)
      setReportSummary(nextReportSummary)
      setReportRows(nextReportRows)
      setTrackingSettings(nextSettings)
      if (effectiveTeamId) {
        setTeamMembers(await client.teamMembers(effectiveTeamId))
      } else {
        setTeamMembers([])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) {
      void loadAll()
    }
  }, [token])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await client.login(loginEmail, loginPassword)
      localStorage.setItem('khaliduo_access_token', result.access_token)
      localStorage.setItem('khaliduo_refresh_token', result.refresh_token)
      setToken(result.access_token)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem('khaliduo_access_token')
    localStorage.removeItem('khaliduo_refresh_token')
    setToken('')
    setMe(null)
  }

  async function handleTeamChange(teamId: string) {
    setSelectedTeamId(teamId)
    await loadAll(teamId)
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newTeamName.trim()) return
    await client.createTeam({ name: newTeamName.trim(), description: newTeamDescription.trim() || undefined })
    setNewTeamName('')
    setNewTeamDescription('')
    await loadAll()
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTeamId || !memberEmployeeId) return
    await client.addTeamMember(selectedTeamId, memberEmployeeId)
    setMemberEmployeeId('')
    await loadAll(selectedTeamId)
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trackingSettings) return
    setTrackingSettings(await client.updateTrackingSettings(trackingSettings))
  }

  if (!token) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={handleLogin}>
          <div className="brand-mark">K</div>
          <h1>Khaliduo Admin</h1>
          <label>
            Email
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} type="password" required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Khaliduo</strong>
            <span>{me?.role ?? 'admin'}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
            <span>{me?.name} · {client.apiBaseUrl}</span>
          </div>
          <div className="topbar-actions">
            <label className="team-filter">
              <Search size={16} />
              <select value={selectedTeamId} onChange={(event) => void handleTeamChange(event.target.value)}>
                <option value="">All teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <button className="icon-button" onClick={() => void loadAll()} title="Refresh">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={logout} title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {error && <div className="banner">{error}</div>}
        {loading && <div className="loading-line" />}

        {view === 'overview' && (
          <>
            <section className="metric-grid">
              <Metric label="Employees" value={summary?.total_employees ?? 0} />
              <Metric label="Online" value={summary?.online_employees ?? 0} />
              <Metric label="Idle" value={summary?.idle_employees ?? 0} />
              <Metric label="Offline" value={summary?.offline_employees ?? 0} />
              <Metric label="Hours Today" value={summary?.total_hours_today ?? 0} />
              <Metric label="Screenshots" value={summary?.screenshots_today ?? 0} />
            </section>
            <DataTable
              title="Teams"
              rows={teams}
              columns={[
                ['Name', (team) => team.name],
                ['Status', (team) => team.status],
                ['Description', (team) => team.description ?? '-'],
              ]}
            />
          </>
        )}

        {view === 'teams' && (
          <section className="split-layout">
            <div>
              <form className="toolbar-form" onSubmit={createTeam}>
                <input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Team name" />
                <input value={newTeamDescription} onChange={(event) => setNewTeamDescription(event.target.value)} placeholder="Description" />
                <button type="submit"><Check size={16} />Create</button>
              </form>
              <DataTable
                title="Teams"
                rows={teams}
                getRowId={(team) => team.id}
                onRowClick={(team) => void handleTeamChange(team.id)}
                activeRowId={selectedTeamId}
                columns={[
                  ['Name', (team) => team.name],
                  ['Status', (team) => team.status],
                  ['Description', (team) => team.description ?? '-'],
                ]}
              />
            </div>
            <div>
              <section className="panel">
                <h2>{selectedTeam?.name ?? 'Team members'}</h2>
                <form className="toolbar-form compact" onSubmit={addMember}>
                  <select value={memberEmployeeId} onChange={(event) => setMemberEmployeeId(event.target.value)}>
                    <option value="">Select employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                  <button type="submit"><Check size={16} />Add</button>
                </form>
                <ul className="member-list">
                  {teamMembers.map((member) => (
                    <li key={member.id}>
                      <span>{member.name}</span>
                      <button onClick={() => selectedTeamId && void client.removeTeamMember(selectedTeamId, member.id).then(() => loadAll(selectedTeamId))}>Remove</button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </section>
        )}

        {view === 'employees' && (
          <DataTable
            title="Employees"
            rows={employees}
            columns={[
              ['Name', (employee) => employee.name],
              ['Email', (employee) => employee.email],
              ['Department', (employee) => employee.department ?? '-'],
              ['Status', (employee) => employee.status],
            ]}
          />
        )}

        {view === 'screenshots' && (
          <section className="screenshot-grid">
            {screenshots.map((shot) => (
              <article key={shot.id} className="screenshot-item">
                <div className="screenshot-thumb">
                  <Monitor size={28} />
                </div>
                <strong>{new Date(shot.captured_at).toLocaleString()}</strong>
                <span>{shot.width}x{shot.height} · {shot.status}</span>
              </article>
            ))}
          </section>
        )}

        {view === 'timesheets' && (
          <DataTable
            title="Daily timesheets"
            rows={timesheets}
            columns={[
              ['Employee', (row) => row.employee_name],
              ['Date', (row) => row.date],
              ['Tracked', (row) => formatSeconds(row.total_tracked_seconds)],
              ['Active', (row) => formatSeconds(row.active_seconds)],
              ['Idle', (row) => formatSeconds(row.idle_seconds)],
              ['Shots', (row) => row.screenshot_count],
            ]}
          />
        )}

        {view === 'reports' && (
          <>
            <section className="metric-grid compact-metrics">
              <Metric label="Tracked" value={formatSeconds(reportSummary?.total_tracked_seconds ?? 0)} />
              <Metric label="Screenshots" value={reportSummary?.screenshots ?? 0} />
            </section>
            <DataTable
              title="Employee reports"
              rows={reportRows}
              columns={[
                ['Name', (row) => row.name],
                ['Email', (row) => row.email],
                ['Active', (row) => formatSeconds(row.active_seconds)],
                ['Idle', (row) => formatSeconds(row.idle_seconds)],
                ['Total', (row) => formatSeconds(row.total_seconds)],
              ]}
            />
          </>
        )}

        {view === 'settings' && trackingSettings && (
          <form className="settings-grid" onSubmit={saveSettings}>
            <Toggle label="Screenshots" checked={trackingSettings.screenshot_enabled} onChange={(value) => setTrackingSettings({ ...trackingSettings, screenshot_enabled: value })} />
            <Toggle label="Capture During Idle" checked={trackingSettings.capture_during_idle} onChange={(value) => setTrackingSettings({ ...trackingSettings, capture_during_idle: value })} />
            <NumberField label="Screenshot Interval" value={trackingSettings.screenshot_interval_minutes} onChange={(value) => setTrackingSettings({ ...trackingSettings, screenshot_interval_minutes: value })} />
            <NumberField label="Idle Threshold" value={trackingSettings.idle_threshold_minutes} onChange={(value) => setTrackingSettings({ ...trackingSettings, idle_threshold_minutes: value })} />
            <NumberField label="Offline Threshold" value={trackingSettings.offline_threshold_minutes} onChange={(value) => setTrackingSettings({ ...trackingSettings, offline_threshold_minutes: value })} />
            <NumberField label="Retention Days" value={trackingSettings.screenshot_retention_days} onChange={(value) => setTrackingSettings({ ...trackingSettings, screenshot_retention_days: value })} />
            <button type="submit" className="save-button"><Check size={16} />Save settings</button>
          </form>
        )}
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function DataTable<T>({
  title,
  rows,
  columns,
  onRowClick,
  activeRowId,
  getRowId,
}: {
  title: string
  rows: T[]
  columns: Array<[string, (row: T) => ReactNode]>
  onRowClick?: (row: T) => void
  activeRowId?: string
  getRowId?: (row: T) => string
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(([label]) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={getRowId?.(row) ?? index}
                className={getRowId?.(row) === activeRowId ? 'selected-row' : ''}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map(([label, render]) => <td key={label}>{render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="number" min={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

export default App
