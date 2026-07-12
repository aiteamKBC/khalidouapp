from app.models import AdminUser


GENERAL_ADMIN = "general_admin"
TEAM_MANAGER = "team_owner"

ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    GENERAL_ADMIN: frozenset(
        {
            "company.manage",
            "admins.manage",
            "teams.manage",
            "employees.manage",
            "settings.manage",
            "tasks.manage_all",
            "tasks.review_all",
            "reports.view_all",
        }
    ),
    TEAM_MANAGER: frozenset(
        {
            "teams.view_owned",
            "employees.view_team",
            "tasks.manage_team",
            "tasks.review_team",
            "reports.view_team",
        }
    ),
}


def capabilities_for_role(role: str) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(role, frozenset())


def capabilities_for_admin(admin: AdminUser) -> list[str]:
    return sorted(capabilities_for_role(admin.role))


def has_capability(admin: AdminUser, capability: str) -> bool:
    return capability in capabilities_for_role(admin.role)
