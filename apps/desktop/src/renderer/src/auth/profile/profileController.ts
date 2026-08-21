import type { UpdateProfileRequest } from '@jameet/shared';
import type { ProfileFormValues } from './profileUi';
import {
  getEditingAvatarColor,
  getEditingAvatarUrl,
  showProfileFeedback,
  clearProfilePasswordInputs
} from './profileUi';

export interface ProfileControllerOptions {
  onUpdateProfile: (payload: UpdateProfileRequest) => Promise<void>;
}

let controllerOptions: ProfileControllerOptions | null = null;

export function initProfileController(options: ProfileControllerOptions): void {
  controllerOptions = options;
}

export async function handleSaveProfile(formValues: ProfileFormValues): Promise<void> {
  if (!controllerOptions) return;

  try {
    const payload: UpdateProfileRequest = {
      displayName: formValues.displayName,
      role: formValues.role,
      location: formValues.location,
      primaryDaw: formValues.primaryDaw,
      genres: formValues.genres,
      bio: formValues.bio,
      socialHandle: formValues.socialHandle,
      avatarColor: getEditingAvatarColor(),
      avatarUrl: getEditingAvatarUrl() || '',
      currentPassword: formValues.currentPassword,
      newPassword: formValues.newPassword
    };

    await controllerOptions.onUpdateProfile(payload);
    showProfileFeedback('✓ Profile updated successfully!', 'success');
    clearProfilePasswordInputs();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update profile.';
    showProfileFeedback(msg, 'error');
  }
}
