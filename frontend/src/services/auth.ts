const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export async function getAuthChallenge(accountId: string): Promise<string> {
  const response = await fetch(
    `${API_BASE}/auth/challenge?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error || "Failed to fetch authentication challenge.",
    );
  }
  const body = await response.json();
  return body.transaction;
}

export async function verifyAuthToken(
  signedTransaction: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTransaction }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error || "Failed to verify authentication signature.",
    );
  }
  const body = await response.json();
  return body.token;
}
