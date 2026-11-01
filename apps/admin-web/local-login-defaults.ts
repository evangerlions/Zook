/** Only explicitly local, non-production servers expose development credentials. */
export function localLoginDefaults(env: NodeJS.ProcessEnv = process.env) {
  if (env.APP_ENV?.trim().toLowerCase() !== "local"
      || env.NODE_ENV?.trim().toLowerCase() === "production") return undefined;
  const username = env.ADMIN_BASIC_AUTH_USERNAME?.trim();
  const password = env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!username || !password) return undefined;
  return { username, password };
}
