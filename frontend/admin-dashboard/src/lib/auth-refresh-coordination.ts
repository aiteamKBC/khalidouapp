export type AuthTokenPair = {
  accessToken: string;
  refreshToken: string;
};

export type RefreshedAuthTokenPair = {
  access_token: string;
  refresh_token: string;
};

export function tokensRotatedByAnotherTab(
  stored: AuthTokenPair | null,
  attemptedRefreshToken: string,
): RefreshedAuthTokenPair | null {
  if (!stored || stored.refreshToken === attemptedRefreshToken) return null;
  return {
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
  };
}
