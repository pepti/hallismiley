// Shared avatar path helpers used by NavBar, ProfileView, SignupView, and AdminUsersView.

const pad = n => String(n).padStart(2, '0');

// Returns the path for avatar number n (1–40), e.g. avatarPath(15) → '/assets/avatars/avatar-15.svg'
export const avatarPath = n => `/assets/avatars/avatar-${pad(n)}.svg`;

// Returns the path for an avatar filename, e.g. avatarPathByName('avatar-15.svg') → '/assets/avatars/avatar-15.svg'
// Falls back to avatar-01.svg if name is falsy.
export const avatarPathByName = name => `/assets/avatars/${name || 'avatar-01.svg'}`;
