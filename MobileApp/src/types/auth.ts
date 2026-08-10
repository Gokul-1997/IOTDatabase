// Mirrors Backend/src/auth/auth.service.js login response exactly.
export interface AuthUser {
  id: number | string;
  email: string;
  username: string;
  company_name: string | null;
  plant_id: number | string | null;
  company_id: number | string | null;
  user_type: string;
  is_snt_super: boolean;
  roles: string[];
  permissions: string[];
  company_permissions?: unknown;
  plan: { plan_code: string; tier: string } | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
}
