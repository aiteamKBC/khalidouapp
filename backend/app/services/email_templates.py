"""Branded, email-client-safe HTML templates for Khaliduo system messages."""

from dataclasses import dataclass
from html import escape

from app.core.config import settings


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def _safe(value: object | None) -> str:
    return escape(str(value or ""), quote=True)


def _brand_logo_url() -> str:
    configured = settings.email_logo_url.strip()
    if configured:
        return configured
    return f"{settings.app_public_url.rstrip('/')}/khaliduo-icon.png"


def _layout(
    *,
    eyebrow: str,
    title: str,
    intro: str,
    content: str,
    action_label: str | None = None,
    action_url: str | None = None,
    footer_note: str | None = None,
) -> str:
    action = ""
    if action_label and action_url:
        action = f"""
        <tr><td align="center" style="padding:8px 36px 30px 36px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="#ef0f60" style="border-radius:10px;">
              <a href="{_safe(action_url)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;">{_safe(action_label)}</a>
            </td>
          </tr></table>
        </td></tr>"""
    support = settings.email_support_address.strip()
    support_html = (
        f'Need help? <a href="mailto:{_safe(support)}" style="color:#ef0f60;text-decoration:none;">{_safe(support)}</a>'
        if support
        else "This is an automated system message from Khaliduo."
    )
    note = (
        f'<p style="margin:10px 0 0 0;font-size:12px;line-height:1.6;color:#8a8797;">{_safe(footer_note)}</p>'
        if footer_note
        else ""
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_safe(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2f7;color:#17132f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f2f7"><tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e2ed;border-radius:16px;overflow:hidden;">
      <tr><td bgcolor="#2f1f72" style="padding:30px 36px;text-align:center;">
        <img src="{_safe(_brand_logo_url())}" width="68" height="68" alt="Khaliduo" style="display:block;width:68px;height:68px;margin:0 auto 18px auto;border:0;border-radius:16px;">
        <div style="margin:0 0 8px 0;color:#ff9abe;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">{_safe(eyebrow)}</div>
        <h1 style="margin:0;color:#ffffff;font-size:27px;line-height:1.25;font-weight:800;">{_safe(title)}</h1>
      </td></tr>
      <tr><td style="padding:30px 36px 12px 36px;">
        <p style="margin:0 0 20px 0;color:#474158;font-size:15px;line-height:1.7;">{_safe(intro)}</p>
        {content}
      </td></tr>
      {action}
      <tr><td bgcolor="#faf9fc" style="padding:20px 36px;border-top:1px solid #eeeaf2;text-align:center;">
        <p style="margin:0;color:#777286;font-size:12px;line-height:1.6;">{support_html}</p>{note}
        <p style="margin:10px 0 0 0;color:#aaa6b2;font-size:11px;">© Khaliduo · Kent Consultancy</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _details_table(rows: list[tuple[str, object | None]]) -> str:
    cells = "".join(
        f"""<tr>
          <td style="padding:9px 12px;color:#777286;font-size:12px;border-bottom:1px solid #eeeaf2;">{_safe(label)}</td>
          <td align="right" style="padding:9px 12px;color:#17132f;font-size:13px;font-weight:700;border-bottom:1px solid #eeeaf2;">{_safe(value)}</td>
        </tr>"""
        for label, value in rows
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;background:#faf9fc;border:1px solid #e7e2ed;border-radius:10px;overflow:hidden;">{cells}</table>'


def employee_invitation_email(
    *, name: str, to: str, invitation_url: str, expires_in_hours: int
) -> EmailContent:
    subject = f"You have been invited to {settings.app_name}"
    text = (
        f"Hi {name},\n\nYour Khaliduo employee account is ready. "
        f"Choose your password here: {invitation_url}\n\n"
        f"This one-time link expires in {expires_in_hours} hours."
    )
    html = _layout(
        eyebrow="Employee invitation",
        title="Welcome to Khaliduo",
        intro=f"Hi {name}, your employee workspace is ready. Choose your password to activate your account.",
        content=_details_table([("Work email", to), ("Link expires", f"{expires_in_hours} hours")]),
        action_label="Accept invitation",
        action_url=invitation_url,
        footer_note="If you were not expecting this invitation, you can safely ignore this email.",
    )
    return EmailContent(subject, text, html)


def password_reset_email(
    *, name: str, reset_url: str, expires_in_minutes: int
) -> EmailContent:
    subject = f"{settings.app_name}: reset your password"
    text = (
        f"Hi {name},\n\nReset your dashboard password here: {reset_url}\n\n"
        f"This single-use link expires in {expires_in_minutes} minutes."
    )
    html = _layout(
        eyebrow="Account security",
        title="Reset your password",
        intro=f"Hi {name}, we received a request to reset your Khaliduo dashboard password.",
        content=_details_table([("Link validity", f"{expires_in_minutes} minutes"), ("Usage", "One time only")]),
        action_label="Reset password",
        action_url=reset_url,
        footer_note="If you did not request this reset, ignore this email. Your password has not changed.",
    )
    return EmailContent(subject, text, html)


def temporary_password_email(
    *, name: str, to: str, password: str, is_reset: bool
) -> EmailContent:
    login_url = f"{settings.app_public_url.rstrip('/')}/login"
    subject = (
        f"{settings.app_name}: your password was reset"
        if is_reset
        else f"You have been invited to {settings.app_name}"
    )
    title = "Your temporary password" if is_reset else "Your dashboard account is ready"
    text = (
        f"Hi {name},\n\nSign in: {login_url}\nEmail: {to}\n"
        f"Temporary password: {password}\n\nChange this password after signing in."
    )
    html = _layout(
        eyebrow="Dashboard access",
        title=title,
        intro=f"Hi {name}, use the temporary credentials below to access the Khaliduo dashboard.",
        content=_details_table([("Email", to), ("Temporary password", password)]),
        action_label="Open dashboard",
        action_url=login_url,
        footer_note="For security, change the temporary password immediately after signing in.",
    )
    return EmailContent(subject, text, html)


def request_review_email(
    *,
    recipient_name: str,
    employee_name: str,
    request_label: str,
    team_names: list[str],
    details: list[tuple[str, object | None]],
    review_url: str,
) -> EmailContent:
    subject = f"Action required: {employee_name} submitted {request_label.lower()}"
    teams = ", ".join(team_names) if team_names else "Company"
    text_details = "\n".join(f"{label}: {value}" for label, value in details)
    text = (
        f"Hi {recipient_name},\n\n{employee_name} submitted a {request_label.lower()} request.\n"
        f"Teams: {teams}\n{text_details}\n\nReview it here: {review_url}"
    )
    html = _layout(
        eyebrow="Approval required",
        title=request_label,
        intro=f"Hi {recipient_name}, {employee_name} submitted a request that needs review.",
        content=_details_table([("Employee", employee_name), ("Team", teams), *details]),
        action_label="Open request centre",
        action_url=review_url,
        footer_note=(
            "This email is a notification only. Approve or reject securely inside the dashboard; "
            "the first authorized reviewer to decide closes the request."
        ),
    )
    return EmailContent(subject, text, html)
