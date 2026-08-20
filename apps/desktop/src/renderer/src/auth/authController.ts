import type { RegisterRequest } from '@jameet/shared';

export interface AuthControllerOptions {
  onLoginAuth: (credentials: { usernameOrEmail: string; password: string }) => Promise<void>;
  onRegisterAuth: (values: RegisterRequest) => Promise<void>;
  onLogoutAuth: () => Promise<void>;
  getPendingJoinCode: () => string | undefined;
  clearPendingJoinCode: () => void;
  onJoinStudio: (code: string) => Promise<void> | void;
  onNavigateHome: () => void;
}

let controllerOptions: AuthControllerOptions | null = null;

export function initAuthController(options: AuthControllerOptions): void {
  controllerOptions = options;
}

export async function handleLogin({
  identifier,
  password
}: {
  identifier: string;
  password: string;
}): Promise<void> {
  if (!controllerOptions) return;
  await controllerOptions.onLoginAuth({ usernameOrEmail: identifier, password });
  const pendingCode = controllerOptions.getPendingJoinCode();
  if (pendingCode) {
    controllerOptions.clearPendingJoinCode();
    void controllerOptions.onJoinStudio(pendingCode);
  } else {
    controllerOptions.onNavigateHome();
  }
}

export async function handleRegister(values: RegisterRequest): Promise<void> {
  if (!controllerOptions) return;
  await controllerOptions.onRegisterAuth(values);
  controllerOptions.onNavigateHome();
}

export async function handleLogout(): Promise<void> {
  if (!controllerOptions) return;
  await controllerOptions.onLogoutAuth();
}
