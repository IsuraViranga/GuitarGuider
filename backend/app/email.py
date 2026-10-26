"""Sending emails through Brevo's HTTP API (Render's free plan blocks SMTP, so no mail server is used)."""

import html
import json
import logging
import urllib.error
import urllib.request

from .config import get_settings

log = logging.getLogger("app.email")
BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def send_email(to_email: str, to_name: str, subject: str, text: str, html_body: str) -> None:
    """Sends one email. Errors are logged, never shown to the visitor (it runs after the answer)."""
    settings = get_settings()
    if not (settings.email_api_key and settings.email_from):
        if settings.email_log_links:
            log.warning("Email to %s (not sent: no EMAIL_API_KEY): %s\n%s", to_email, subject, text)
        return
    payload = {
        "sender": {"name": settings.email_from_name, "email": settings.email_from},
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "textContent": text,
        "htmlContent": html_body,
    }
    request = urllib.request.Request(
        BREVO_URL,
        data=json.dumps(payload).encode(),
        headers={"api-key": settings.email_api_key, "content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            log.info("Email to %s accepted by Brevo: %s", to_email, response.read()[:200].decode(errors="replace"))
    except urllib.error.HTTPError as error:
        # Brevo says why (e.g. sender not confirmed, unknown IP address, account not activated).
        reason = error.read()[:500].decode(errors="replace")
        log.error("Brevo refused the email to %s (HTTP %s): %s", to_email, error.code, reason)
    except Exception:  # noqa: BLE001 - a failed email must not break the request that asked for it
        log.exception("Could not send the email to %s", to_email)


def send_password_reset(to_email: str, name: str, link: str, minutes: int) -> None:
    text = (
        f"Hello {name},\n\n"
        f"Someone (hopefully you) asked to reset the password of your Melantha Guitar Academy account.\n"
        f"Open this link to choose a new password. It works once, for {minutes} minutes:\n\n{link}\n\n"
        "If you did not ask for this, you can ignore this email: your password stays the same.\n"
    )
    safe_name, safe_link = html.escape(name), html.escape(link, quote=True)
    html_body = f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#14101c;color:#f4efe6;border-radius:16px">
<h1 style="font-size:22px;color:#ffc35c;margin:0 0 12px">Melantha Guitar Academy</h1>
<p>Hello {safe_name},</p>
<p>Someone (hopefully you) asked to reset the password of your account.</p>
<p style="text-align:center;margin:24px 0"><a href="{safe_link}" style="background:#f5a524;color:#1b1206;padding:12px 24px;border-radius:999px;font-weight:bold;text-decoration:none">Choose a new password</a></p>
<p style="font-size:14px;color:#b8afc4">The link works once, for {minutes} minutes. If you did not ask for this, ignore this email: your password stays the same.</p>
</div>"""
    send_email(to_email, name, "Reset your Melantha Guitar Academy password", text, html_body)
