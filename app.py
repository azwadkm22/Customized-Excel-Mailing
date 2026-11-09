#!/usr/bin/env python3
"""
Local GUI webapp for composing and sending templated invitation emails
from an uploaded .xlsx file.

Run:
    pip install -r requirements.txt
    python3 app.py

Then open http://127.0.0.1:5000 in a browser. The app binds to localhost
only — it is a personal tool, not meant to be exposed on a network, since
it handles your email password in memory during a send.
"""

import json
import smtplib
import ssl
import time
from email.message import EmailMessage
from io import BytesIO

import pandas as pd
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

app = Flask(__name__)

# In-memory dataset for the currently uploaded file. This is a single-user
# local tool, so one process-level global is enough — no session/multi-user
# handling is needed.
DATASET: list[dict] | None = None
COLUMNS: list[str] | None = None


def guess_email_column(columns: list[str]) -> str | None:
    for col in columns:
        if "email" in col.lower():
            return col
    return None


def render_one(template: str, row: dict, variables: list[str], email_column: str) -> str:
    """Render `template` using only the selected variables (plus the email column)."""
    allowed_keys = set(variables) | {email_column}
    allowed_row = {k: v for k, v in row.items() if k in allowed_keys}
    try:
        return template.format(**allowed_row)
    except KeyError as exc:
        raise ValueError(f"Unknown variable {{{exc.args[0]}}} — select that column as a variable first.")
    except (IndexError, ValueError) as exc:
        raise ValueError(f"Invalid template: {exc}")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    global DATASET, COLUMNS

    file = request.files.get("file")
    if file is None or file.filename == "":
        return jsonify({"error": "No file uploaded."}), 400

    if not file.filename.lower().endswith(".xlsx"):
        return jsonify({"error": "File must be a .xlsx file."}), 400

    try:
        df = pd.read_excel(BytesIO(file.read()), dtype=str)
    except Exception as exc:
        return jsonify({"error": f"Could not read Excel file: {exc}"}), 400

    df = df.dropna(how="all")
    for col in df.columns:
        df[col] = df[col].str.strip()
    df = df.fillna("")

    if df.empty or len(df.columns) == 0:
        return jsonify({"error": "The uploaded file has no usable rows/columns."}), 400

    columns = [str(c) for c in df.columns]
    rows = df.to_dict(orient="records")

    DATASET = rows
    COLUMNS = columns

    return jsonify(
        {
            "columns": columns,
            "row_count": len(rows),
            "sample_row": rows[0] if rows else {},
            "suggested_email_column": guess_email_column(columns),
        }
    )


@app.route("/api/preview", methods=["POST"])
def preview():
    if not DATASET:
        return jsonify({"error": "Upload a file first."}), 400

    data = request.get_json(force=True)
    variables = data.get("variables", [])
    email_column = data.get("email_column")
    subject_template = data.get("subject_template", "")
    body_template = data.get("body_template", "")
    row_index = int(data.get("row_index", 0))

    if not email_column:
        return jsonify({"error": "Select a recipient email column first."}), 400

    if row_index < 0 or row_index >= len(DATASET):
        return jsonify({"error": "Row index out of range."}), 400

    row = DATASET[row_index]

    try:
        subject = render_one(subject_template, row, variables, email_column)
        body = render_one(body_template, row, variables, email_column)
    except ValueError as exc:
        return jsonify({"error": str(exc)})

    return jsonify({"to": row.get(email_column, ""), "subject": subject, "body": body})


@app.route("/api/preview_all", methods=["POST"])
def preview_all():
    if not DATASET:
        return jsonify({"error": "Upload a file first."}), 400

    data = request.get_json(force=True)
    variables = data.get("variables", [])
    email_column = data.get("email_column")
    subject_template = data.get("subject_template", "")
    body_template = data.get("body_template", "")

    if not email_column:
        return jsonify({"error": "Select a recipient email column first."}), 400

    results = []
    for row in DATASET:
        to = row.get(email_column, "")
        try:
            subject = render_one(subject_template, row, variables, email_column)
            body = render_one(body_template, row, variables, email_column)
            results.append({"to": to, "subject": subject, "body": body})
        except ValueError as exc:
            results.append({"to": to, "error": str(exc)})

    return jsonify({"results": results})


@app.route("/api/send", methods=["POST"])
def send():
    if not DATASET:
        return jsonify({"error": "Upload a file first."}), 400

    data = request.get_json(force=True)
    variables = data.get("variables", [])
    email_column = data.get("email_column")
    subject_template = data.get("subject_template", "")
    body_template = data.get("body_template", "")
    smtp_host = data.get("smtp_host", "smtp.gmail.com")
    smtp_port = int(data.get("smtp_port", 587))
    sender = data.get("sender", "")
    password = data.get("password", "")
    delay = float(data.get("delay", 0.5))

    if not email_column:
        return jsonify({"error": "Select a recipient email column first."}), 400
    if not sender or not password:
        return jsonify({"error": "Sender email and password are required."}), 400

    dataset = DATASET  # snapshot the reference for the generator

    def generate():
        sent = 0
        failed = 0
        context = ssl.create_default_context()
        try:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls(context=context)
                server.login(sender, password)

                for row in dataset:
                    to = row.get(email_column, "")
                    try:
                        subject = render_one(subject_template, row, variables, email_column)
                        body = render_one(body_template, row, variables, email_column)

                        msg = EmailMessage()
                        msg["From"] = sender
                        msg["To"] = to
                        msg["Subject"] = subject
                        msg.set_content(body)

                        server.send_message(msg)
                        sent += 1
                        yield json.dumps({"to": to, "ok": True}) + "\n"
                    except Exception as exc:
                        failed += 1
                        yield json.dumps({"to": to, "ok": False, "error": str(exc)}) + "\n"

                    if delay > 0:
                        time.sleep(delay)
        except Exception as exc:
            yield json.dumps({"ok": False, "error": f"SMTP connection failed: {exc}"}) + "\n"

        yield json.dumps({"done": True, "sent": sent, "failed": failed}) + "\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
