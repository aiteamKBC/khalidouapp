import { apiFetch } from "./client";
import type { DataScope, PermissionMode, Role } from "@/types";

export type PermissionDefinition = {
  key: string;
  label: string;
  group: string;
  description: string;
};

export type PermissionCatalog = {
  permissions: PermissionDefinition[];
  rolePresets: Record<Role, string[]>;
  permissionModes: PermissionMode[];
  dataScopes: DataScope[];
};

export type AdminAccess = {
  adminUserId: string;
  role: Role;
  isSuperAdmin: boolean;
  permissionMode: PermissionMode;
  dataScope: DataScope;
  basePermissions: string[];
  permissionOverrides: Record<string, boolean>;
  effectivePermissions: string[];
  teamLeadTeamIds: string[];
  trackAsEmployee: boolean;
  trackedEmployeeId?: string;
};

export type AdminAccessUpdate = Partial<{
  role: Role;
  permissionMode: PermissionMode;
  dataScope: DataScope;
  permissionOverrides: Record<string, boolean>;
  teamLeadTeamIds: string[];
  trackAsEmployee: boolean;
}>;

type BackendCatalog = {
  permissions: PermissionDefinition[];
  role_presets: Record<Role, string[]>;
  permission_modes: PermissionMode[];
  data_scopes: DataScope[];
};

type BackendAccess = {
  admin_user_id: string;
  role: Role;
  is_super_admin?: boolean;
  permission_mode: PermissionMode;
  data_scope: DataScope;
  base_permissions: string[];
  permission_overrides: Record<string, boolean>;
  effective_permissions: string[];
  team_lead_team_ids: string[];
  track_as_employee: boolean;
  tracked_employee_id?: string | null;
};

function mapAccess(row: BackendAccess): AdminAccess {
  return {
    adminUserId: row.admin_user_id,
    role: row.role,
    isSuperAdmin: row.is_super_admin ?? false,
    permissionMode: row.permission_mode,
    dataScope: row.data_scope,
    basePermissions: row.base_permissions,
    permissionOverrides: row.permission_overrides,
    effectivePermissions: row.effective_permissions,
    teamLeadTeamIds: row.team_lead_team_ids,
    trackAsEmployee: row.track_as_employee,
    trackedEmployeeId: row.tracked_employee_id ?? undefined,
  };
}

export async function getPermissionCatalog(): Promise<PermissionCatalog> {
  const row = await apiFetch<BackendCatalog>("/users/permissions/catalog");
  return {
    permissions: row.permissions,
    rolePresets: row.role_presets,
    permissionModes: row.permission_modes,
    dataScopes: row.data_scopes,
  };
}

export async function getAdminAccess(adminUserId: string): Promise<AdminAccess> {
  return mapAccess(await apiFetch<BackendAccess>(`/users/${adminUserId}/access`));
}

export async function updateAdminAccess(
  adminUserId: string,
  input: AdminAccessUpdate,
): Promise<AdminAccess> {
  return mapAccess(
    await apiFetch<BackendAccess>(`/users/${adminUserId}/access`, {
      method: "PATCH",
      body: JSON.stringify({
        role: input.role,
        permission_mode: input.permissionMode,
        data_scope: input.dataScope,
        permission_overrides: input.permissionOverrides,
        team_lead_team_ids: input.teamLeadTeamIds,
        track_as_employee: input.trackAsEmployee,
      }),
    }),
  );
}
