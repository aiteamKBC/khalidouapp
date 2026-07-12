from fastapi import APIRouter

from app.api.v1 import (
    activity,
    agent,
    audit,
    auth,
    dashboard,
    devices,
    downloads,
    employee_auth,
    employee_portal,
    employees,
    health,
    people,
    projects,
    reports,
    screenshots,
    sessions,
    settings,
    teams,
    time_adjustments,
    timesheets,
    updates,
    users,
)

api_router = APIRouter()
api_router.include_router(downloads.router)
api_router.include_router(updates.router)
api_router.include_router(agent.router)
api_router.include_router(employee_auth.router)
api_router.include_router(employee_portal.router)
api_router.include_router(auth.router)
api_router.include_router(people.router)
api_router.include_router(teams.router)
api_router.include_router(dashboard.router)
api_router.include_router(users.router)
api_router.include_router(sessions.router)
api_router.include_router(activity.router)
api_router.include_router(audit.router)
api_router.include_router(employees.router)
api_router.include_router(screenshots.router)
api_router.include_router(devices.router)
api_router.include_router(projects.router)
api_router.include_router(time_adjustments.router)
api_router.include_router(timesheets.router)
api_router.include_router(reports.router)
api_router.include_router(settings.router)
api_router.include_router(health.router, tags=["health"])
