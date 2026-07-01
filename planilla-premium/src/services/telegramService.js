import { auth } from "../lib/firebase"

const LINK_CODE_ENDPOINT = "/.netlify/functions/telegram-link-code"

/**
 * Requests a short-lived link code from the backend. The user then sends it to
 * the bot as `/start CODE` to bind their Telegram chat to their account.
 * Returns { code, botUsername, expiresInMinutes }.
 */
export async function generateTelegramLinkCode() {
  const user = auth.currentUser
  if (!user) throw new Error("No hay una sesión activa.")

  const idToken = await user.getIdToken()
  const res = await fetch(LINK_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "No se pudo generar el código de vinculación.")
  }

  return res.json()
}
