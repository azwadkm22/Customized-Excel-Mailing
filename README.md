# Customized Excel Mailing Tool

A small local webapp for sending templated, personalized emails from an Excel (`.xlsx`) file. Upload a sheet, pick which columns are variables, write a Subject/Body using `{ColumnName}` placeholders, and send through
your own SMTP account (e.g. Gmail).

Runs entirely on your machine — it binds to `127.0.0.1` only and never writes your email password to disk.

## Requirements

- Python 3.9+
- pip

## Setup

From this folder:

```bash
python3 -m venv venv
source venv/bin/activate      # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```
(You can skip the virtualenv and `pip install -r requirements.txt`
directly if you don't mind installing Flask/pandas/openpyxl globally.)

## Run

```bash
python3 app.py
```
Then open **http://127.0.0.1:5001** in your browser.

Stop the server with `Ctrl+C` in the terminal.

### Quick start

You can skip the manual steps above and just run the included launcher,
which starts the server and opens the webapp in your default browser
automatically:

- **Windows:** double-click `run.bat` (or run it from a terminal).
- **macOS/Linux:** run `./run.sh` from this folder.

## Using it

1. **Upload** — pick an `.xlsx` file and click Upload. The file's columns
   and row count are detected automatically.
2. **Select variables** — check which columns you want available as
   `{Variable}` placeholders, and pick which column holds the recipient's
   email address (auto-guessed if a column name contains "email").
3. **Compose** — write the Subject and Body. Click any variable button to
   insert `{ColumnName}` at your cursor in whichever field you last
   clicked into. Use "Preview" to render one row at a time and check the
   result.
4. **Sender & send** — enter your SMTP host/port (defaults to Gmail),
   your email address, and your app password. Use **Preview All (Dry
   Run)** to see every recipient's rendered email before sending anything.
   **Send Emails** asks for confirmation, then sends one-by-one with a
   live log and a final sent/failed count.

### Gmail app password

If sending from a Gmail account with 2-Step Verification on, generate an
[App Password](https://myaccount.google.com/apppasswords) and use that
in the password field instead of your normal login password.

## Notes

- Excel column names can contain spaces (e.g. `Student Id`) — just use
  them in curly braces as-is, e.g. `{Student Id}`.
- If a template references a column you didn't check as a variable, the
  preview/send will report a clear error instead of sending a broken
  email.
- The uploaded data and any password are kept only in the running
  process's memory, and are discarded once you close the server.
