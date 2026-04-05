#!/usr/bin/env python3
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def main() -> int:
    subject = sys.argv[1] if len(sys.argv) > 1 else "Golf sync alert"
    body = sys.stdin.read().strip()

    smtp_host = os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("ALERT_SMTP_PORT", "465"))
    smtp_user = os.environ.get("ALERT_SMTP_USER")
    smtp_pass = os.environ.get("ALERT_SMTP_PASS")
    email_to = os.environ.get("ALERT_EMAIL_TO")
    email_from = os.environ.get("ALERT_EMAIL_FROM", smtp_user or "")
    use_starttls = os.environ.get("ALERT_SMTP_STARTTLS", "0") == "1"

    if not smtp_user or not smtp_pass or not email_to or not email_from:
        print("Missing ALERT_SMTP_USER, ALERT_SMTP_PASS, ALERT_EMAIL_TO, or ALERT_EMAIL_FROM", file=sys.stderr)
        return 1

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = email_from
    message["To"] = email_to
    message.set_content(body or "Golf sync alert triggered.")

    if use_starttls:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.starttls(context=ssl.create_default_context())
            server.login(smtp_user, smtp_pass)
            server.send_message(message)
    else:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30, context=ssl.create_default_context()) as server:
            server.login(smtp_user, smtp_pass)
            server.send_message(message)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
