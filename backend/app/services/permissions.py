from sqlalchemy import delete, select
from sqlalchemy.orm import Session, object_session

from app.core.exceptions import ApiError
from app.models import AdminPermissionOverride, AdminUser


GENERAL_ADMIN = "general_admin"
TEAM_MANAGER = "team_owner"
HR_MANAGER = "hr"

ROLE_RANKS: dict[str, int] = {
    TEAM_MANAGER: 1,
    HR_MANAGER: 2,
    GENERAL_ADMIN: 3,
}

PERMISSION_CATALOG: tuple[dict[str, str], ...] = (
    {
        "key": "dashboard.view",
        "label": "View dashboard",
        "group": "General",
        "description": "Open the administration dashboard.",
    },
    {
        "key": "access.manage",
        "label": "Manage access",
        "group": "Administration",
        "description": "Create admin accounts and change individual access.",
    },
    {
        "key": "audit.view",
        "label": "View audit log",
        "group": "Administration",
        "description": "Review security and administration activity.",
    },
    {
        "key": "settings.view",
        "label": "View settings",
        "group": "Administration",
        "description": "View company tracking settings.",
    },
    {
        "key": "settings.manage",
        "label": "Manage settings",
        "group": "Administration",
        "description": "Change company tracking settings.",
    },
    {
        "key": "teams.view",
        "label": "View teams",
        "group": "People",
        "description": "View teams inside the assigned data scope.",
    },
    {
        "key": "teams.manage",
        "label": "Manage teams",
        "group": "People",
        "description": "Create teams and manage members and team leads.",
    },
    {
        "key": "people.view",
        "label": "View people",
        "group": "People",
        "description": "View people inside the assigned data scope.",
    },
    {
        "key": "people.manage",
        "label": "Manage people",
        "group": "People",
        "description": "Invite and edit people.",
    },
    {
        "key": "people.archive",
        "label": "Archive people",
        "group": "People",
        "description": "Archive and restore people and their access.",
    },
    {
        "key": "payroll.manage",
        "label": "Manage payroll",
        "group": "Payroll",
        "description": "Manage employee work profiles, salary, overtime and deduction rules.",
    },
    {
        "key": "payroll.view",
        "label": "View payroll",
        "group": "Payroll",
        "description": "View payroll previews and employee pay rules.",
    },
    {
        "key": "live_activity.view",
        "label": "View live activity",
        "group": "Tracking",
        "description": "View live status and work sessions.",
    },
    {
        "key": "screenshots.view",
        "label": "View screenshots",
        "group": "Tracking",
        "description": "View screenshots inside the assigned data scope.",
    },
    {
        "key": "screenshots.manage",
        "label": "Manage screenshots",
        "group": "Tracking",
        "description": "Delete screenshots and manage screenshot storage.",
    },
    {
        "key": "timesheets.view",
        "label": "View timesheets",
        "group": "Tracking",
        "description": "View timesheets inside the assigned data scope.",
    },
    {
        "key": "timesheets.manage",
        "label": "Manage timesheets",
        "group": "Tracking",
        "description": "Manage recorded time.",
    },
    {
        "key": "time_requests.view",
        "label": "View time requests",
        "group": "Tracking",
        "description": "View time adjustment requests.",
    },
    {
        "key": "time_requests.manage",
        "label": "Manage time requests",
        "group": "Tracking",
        "description": "Approve or reject time adjustment requests.",
    },
    {
        "key": "breaks.view",
        "label": "View breaks",
        "group": "Tracking",
        "description": "View employee break rules and usage.",
    },
    {
        "key": "leave_requests.view",
        "label": "View holiday requests",
        "group": "Leave",
        "description": "View holiday requests inside the assigned data scope.",
    },
    {
        "key": "leave_requests.manage",
        "label": "Approve holiday requests",
        "group": "Leave",
        "description": "Manage holiday credits and approve or reject requests.",
    },
    {
        "key": "devices.view",
        "label": "View devices",
        "group": "Tracking",
        "description": "View enrolled devices.",
    },
    {
        "key": "devices.manage",
        "label": "Manage devices",
        "group": "Tracking",
        "description": "Enroll, update, or revoke devices and backup codes.",
    },
    {
        "key": "projects.view",
        "label": "View projects and tasks",
        "group": "Work",
        "description": "View projects and tasks inside the assigned data scope.",
    },
    {
        "key": "projects.manage",
        "label": "Manage projects and tasks",
        "group": "Work",
        "description": "Create and update projects and tasks inside the assigned data scope.",
    },
    {
        "key": "notifications.view",
        "label": "View notifications",
        "group": "Work",
        "description": "View task and workflow notifications.",
    },
    {
        "key": "reports.view",
        "label": "View reports",
        "group": "Reports",
        "description": "View reports inside the assigned data scope.",
    },
    {
        "key": "reports.export",
        "label": "Export reports",
        "group": "Reports",
        "description": "Export report data.",
    },
)

MANAGED_PERMISSION_KEYS = frozenset(item["key"] for item in PERMISSION_CATALOG)

LEGACY_GENERAL_CAPABILITIES = frozenset(
    {
        "company.manage",
        "admins.manage",
        "employees.manage",
        "screenshots.delete",
        "timesheets.adjust",
        "tasks.manage_all",
        "tasks.review_all",
        "reports.view_all",
    }
)
LEGACY_TEAM_CAPABILITIES = frozenset(
    {
        "teams.view_owned",
        "employees.view_team",
        "tasks.manage_team",
        "tasks.review_team",
        "reports.view_team",
    }
)

ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    GENERAL_ADMIN: MANAGED_PERMISSION_KEYS | LEGACY_GENERAL_CAPABILITIES,
    HR_MANAGER: MANAGED_PERMISSION_KEYS | LEGACY_GENERAL_CAPABILITIES,
    TEAM_MANAGER: frozenset(
        {
            "teams.view",
            "dashboard.view",
            "people.view",
            "live_activity.view",
            "screenshots.view",
            "timesheets.view",
            "time_requests.view",
            "time_requests.manage",
            "devices.view",
            "projects.view",
            "projects.manage",
            "notifications.view",
            "reports.view",
        }
    )
    | LEGACY_TEAM_CAPABILITIES,
}

# Role inheritance is one-way: a General Admin always includes every Team
# Leader capability, while Team Leaders never inherit company administration.
ROLE_CAPABILITIES[GENERAL_ADMIN] = (
    ROLE_CAPABILITIES[GENERAL_ADMIN] | ROLE_CAPABILITIES[TEAM_MANAGER]
)
ROLE_CAPABILITIES[HR_MANAGER] = ROLE_CAPABILITIES[GENERAL_ADMIN]

VALID_PERMISSION_KEYS = frozenset().union(*ROLE_CAPABILITIES.values())
FULL_ADMIN_REQUIRED_PERMISSIONS = frozenset(
    {
        "access.manage",
        "people.manage",
        "people.archive",
        "teams.manage",
        "settings.manage",
        "audit.view",
    }
)


def capabilities_for_role(role: str) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(role, frozenset())


def permission_overrides_for_admin(admin: AdminUser) -> dict[str, bool]:
    session = object_session(admin)
    if session is None or admin.id is None:
        return {
            row.permission_key: row.allowed for row in getattr(admin, "permission_overrides", [])
        }
    rows = session.scalars(
        select(AdminPermissionOverride).where(AdminPermissionOverride.admin_user_id == admin.id)
    ).all()
    return {row.permission_key: row.allowed for row in rows}


def capabilities_for_admin(admin: AdminUser) -> list[str]:
    effective = (
        set(capabilities_for_role(admin.role))
        if getattr(admin, "permission_mode", "role") == "role"
        else set()
    )
    for key, allowed in permission_overrides_for_admin(admin).items():
        if allowed:
            effective.add(key)
        else:
            effective.discard(key)
    return sorted(effective)


def has_capability(admin: AdminUser, capability: str) -> bool:
    return capability in capabilities_for_admin(admin)


def require_capability(admin: AdminUser, capability: str) -> None:
    if not has_capability(admin, capability):
        raise ApiError("FORBIDDEN", "You do not have permission to perform this action.", 403)


def has_company_data_scope(admin: AdminUser) -> bool:
    return getattr(admin, "data_scope", None) == "company"


def is_full_admin(admin: AdminUser) -> bool:
    return has_company_data_scope(admin) and FULL_ADMIN_REQUIRED_PERMISSIONS.issubset(
        capabilities_for_admin(admin)
    )


def is_super_admin(admin: AdminUser) -> bool:
    return bool(getattr(admin, "is_super_admin", False))


def role_rank(admin_or_role: AdminUser | str) -> int:
    if isinstance(admin_or_role, AdminUser):
        if is_super_admin(admin_or_role):
            return 4
        return ROLE_RANKS.get(admin_or_role.role, 0)
    return ROLE_RANKS.get(admin_or_role, 0)


def can_manage_admin(actor: AdminUser, target: AdminUser) -> bool:
    if is_super_admin(target):
        return False
    if is_super_admin(actor):
        return actor.company_id == target.company_id
    return actor.company_id == target.company_id and has_capability(actor, "access.manage")


def require_can_manage_admin(actor: AdminUser, target: AdminUser) -> None:
    if actor.id == target.id:
        return
    if not can_manage_admin(actor, target):
        raise ApiError(
            "CANNOT_MANAGE_ADMIN",
            "You can only manage admin accounts below your own access level.",
            403,
        )


def require_can_assign_role(actor: AdminUser, role: str) -> None:
    if is_super_admin(actor):
        return
    if not has_capability(actor, "access.manage"):
        raise ApiError(
            "CANNOT_ASSIGN_ROLE",
            "You can only assign roles below your own access level.",
            403,
        )


def replace_permission_overrides(
    db: Session,
    admin: AdminUser,
    overrides: dict[str, bool],
) -> None:
    unknown = set(overrides) - VALID_PERMISSION_KEYS
    if unknown:
        raise ApiError(
            "INVALID_PERMISSION",
            f"Unknown permission: {sorted(unknown)[0]}",
            400,
        )
    db.execute(
        delete(AdminPermissionOverride).where(AdminPermissionOverride.admin_user_id == admin.id)
    )
    for key, allowed in overrides.items():
        db.add(
            AdminPermissionOverride(
                company_id=admin.company_id,
                admin_user_id=admin.id,
                permission_key=key,
                allowed=allowed,
            )
        )


def permission_catalog_payload() -> dict:
    return {
        "permissions": list(PERMISSION_CATALOG),
        "role_presets": {
            role: sorted(keys & MANAGED_PERMISSION_KEYS) for role, keys in ROLE_CAPABILITIES.items()
        },
        "permission_modes": ["role", "custom"],
        "data_scopes": ["company", "assigned_teams"],
    }
