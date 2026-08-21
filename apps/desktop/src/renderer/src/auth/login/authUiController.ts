import { initAuthUi, type RegisterFormValues } from './authUi';

export interface AuthUiControllerOptions {
  onOpenSignIn: () => void;
  onOpenRegister: () => void;
  onNavigateHome: () => void;
  onLogout: () => void;
  onLogin: (credentials: { identifier: string; password: string }) => Promise<void> | void;
  onRegister: (values: RegisterFormValues) => Promise<void> | void;
}

export function initAuthUiController(options: AuthUiControllerOptions): void {
  initAuthUi({
    onOpenSignIn: () => options.onOpenSignIn(),
    onOpenRegister: () => options.onOpenRegister(),
    onNavigateHome: () => options.onNavigateHome(),
    onLogout: () => {
      options.onLogout();
    },
    onLogin: (credentials) => options.onLogin(credentials),
    onRegister: (values) => options.onRegister(values)
  });
}
