let columns = [];
let rowCount = 0;
let lastFocused = null;

const el = (id) => document.getElementById(id);

const subjectInput = el("subjectInput");
const bodyInput = el("bodyInput");

subjectInput.addEventListener("focus", () => (lastFocused = subjectInput));
bodyInput.addEventListener("focus", () => (lastFocused = bodyInput));

function insertAtCursor(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  field.focus();
  field.selectionStart = field.selectionEnd = start + text.length;
}

function checkedColumns() {
  return [...document.querySelectorAll("#columnChecks input:checked")].map((cb) => cb.value);
}

function renderVarButtons() {
  const vars = checkedColumns();
  for (const containerId of ["subjectVarButtons", "bodyVarButtons"]) {
    const container = el(containerId);
    container.innerHTML = "";
    for (const name of vars) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `{${name}}`;
      btn.addEventListener("click", () => {
        const target = containerId === "subjectVarButtons" ? subjectInput : bodyInput;
        insertAtCursor(target, `{${name}}`);
      });
      container.appendChild(btn);
    }
  }
}

function enableStep(id) {
  el(id).classList.remove("disabled");
}

// --- Step 1: upload ---------------------------------------------------

el("uploadBtn").addEventListener("click", async () => {
  const fileInput = el("fileInput");
  const status = el("uploadStatus");
  if (!fileInput.files.length) {
    status.textContent = "Choose a .xlsx file first.";
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  status.textContent = "Uploading...";
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok || data.error) {
    status.textContent = `Error: ${data.error || "upload failed"}`;
    return;
  }

  columns = data.columns;
  rowCount = data.row_count;
  status.textContent = `Loaded ${rowCount} row(s), ${columns.length} column(s).`;

  // Step 2: column checkboxes + email column select
  const columnChecks = el("columnChecks");
  columnChecks.innerHTML = "";
  for (const col of columns) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = col;
    cb.checked = true;
    cb.addEventListener("change", renderVarButtons);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(col));
    columnChecks.appendChild(label);
  }

  const emailSelect = el("emailColumnSelect");
  emailSelect.innerHTML = "";
  for (const col of columns) {
    const opt = document.createElement("option");
    opt.value = col;
    opt.textContent = col;
    emailSelect.appendChild(opt);
  }
  if (data.suggested_email_column) {
    emailSelect.value = data.suggested_email_column;
  }

  const rowSelect = el("previewRowSelect");
  rowSelect.innerHTML = "";
  for (let i = 0; i < rowCount; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `Row ${i + 1}`;
    rowSelect.appendChild(opt);
  }

  renderVarButtons();
  enableStep("step-variables");
  enableStep("step-compose");
  enableStep("step-send");
});

// --- Step 3: preview one row -------------------------------------------

function currentTemplateRequest(extra) {
  return {
    variables: checkedColumns(),
    email_column: el("emailColumnSelect").value,
    subject_template: subjectInput.value,
    body_template: bodyInput.value,
    ...extra,
  };
}

el("previewBtn").addEventListener("click", async () => {
  const panel = el("previewPanel");
  panel.innerHTML = "Loading preview...";

  const rowIndex = Number(el("previewRowSelect").value || 0);
  const res = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentTemplateRequest({ row_index: rowIndex })),
  });
  const data = await res.json();

  if (data.error) {
    panel.innerHTML = `<div class="entry error">${data.error}</div>`;
    return;
  }

  panel.innerHTML = `<div class="entry"><strong>To:</strong> ${data.to}<br><strong>Subject:</strong> ${data.subject}<br><strong>Body:</strong><br>${data.body.replace(/\n/g, "<br>")}</div>`;
});

// --- Step 4: preview all / send ----------------------------------------

el("previewAllBtn").addEventListener("click", async () => {
  const panel = el("previewAllPanel");
  panel.innerHTML = "Loading...";

  const res = await fetch("/api/preview_all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentTemplateRequest()),
  });
  const data = await res.json();

  if (data.error) {
    panel.innerHTML = `<div class="entry error">${data.error}</div>`;
    return;
  }

  panel.innerHTML = data.results
    .map((r) =>
      r.error
        ? `<div class="entry error">${r.to || "(no recipient)"}: ${r.error}</div>`
        : `<div class="entry"><strong>To:</strong> ${r.to}<br><strong>Subject:</strong> ${r.subject}<br><strong>Body:</strong><br>${r.body.replace(/\n/g, "<br>")}</div>`
    )
    .join("");
});

el("sendBtn").addEventListener("click", async () => {
  const sender = el("senderInput").value.trim();
  const password = el("passwordInput").value;
  if (!sender || !password) {
    alert("Sender email and password are required.");
    return;
  }
  if (!confirm(`Send ${rowCount} email(s) now? This cannot be undone.`)) {
    return;
  }

  const sendBtn = el("sendBtn");
  sendBtn.disabled = true;
  const log = el("sendLog");
  log.innerHTML = "";

  const payload = currentTemplateRequest({
    smtp_host: el("smtpHost").value,
    smtp_port: Number(el("smtpPort").value),
    sender,
    password,
    delay: Number(el("delayInput").value),
  });

  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      log.innerHTML = `<div class="entry error">${data.error || "Send failed."}</div>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        const msg = JSON.parse(line);
        const entry = document.createElement("div");
        if (msg.done) {
          entry.className = "entry";
          entry.innerHTML = `<strong>Done.</strong> Sent: ${msg.sent}, Failed: ${msg.failed}`;
        } else if (msg.ok) {
          entry.className = "entry ok";
          entry.textContent = `Sent to ${msg.to}`;
        } else {
          entry.className = "entry fail";
          entry.textContent = `Failed for ${msg.to || "(connection)"}: ${msg.error}`;
        }
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
      }
    }
  } finally {
    sendBtn.disabled = false;
    el("passwordInput").value = "";
  }
});
