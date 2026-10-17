"use strict";

// Paste your API Gateway "Invoke URL" here (no trailing slash needed).
const API_BASE_URL = "https://ajg34gqivc.execute-api.ap-southeast-2.amazonaws.com";

const SUBJECTS = ["Data Structures", "Database Management", "Machine Learning", "Computer Networks", "Python"];
const FIELDS = [
  ["rollNumber", "Roll number", "text"],
  ["studentName", "Student name", "text"],
  ["email", "Email", "email"],
  ["course", "Course", "text"],
  ["semester", "Semester (1–8)", "number"],
];
const KEYS = [...FIELDS.map(f => f[0]), ...[1, 2, 3, 4, 5].map(i => "subject" + i)];

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = r => `<span class="badge ${r === "PASS" ? "ok" : "bad"}">${esc(r)}</span>`;
const state = (m, c = "") => `<div class="state ${c}">${m}</div>`;
const LOADING = '<div class="state"><span class="spin"></span>Loading…</div>';

let current = "dashboard", editingId = null, deletingId = null, searchSeq = 0;

/* ---------- UI helpers ---------- */
function showNotification(msg, type = "success") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 4500);
}

function logout() {
  sessionStorage.removeItem("pc");
  $("#passcode").value = "";
  $("#login").hidden = false;
}

function nav(name) {
  current = name;
  document.querySelectorAll("main section").forEach(s => (s.hidden = s.id !== "sec-" + name));
  document.querySelectorAll("aside [data-nav]").forEach(b => b.classList.toggle("on", b.dataset.nav === name));
  load(name);
  scrollTo(0, 0);
}

function load(name) {
  if (name === "dashboard") loadDashboardStats();
  if (name === "students") loadStudents();
  if (name === "search") { $("#searchInput").focus(); searchStudent(); }
}
const reload = () => load(current);

/* ---------- API client ---------- */
async function apiRequest(method, path, body) {
  if (API_BASE_URL.startsWith("YOUR_")) {
    throw { code: "CONFIG", message: "API URL not set. Edit API_BASE_URL in script.js." };
  }
  let res;
  try {
    res = await fetch(API_BASE_URL.replace(/\/$/, "") + path, {
      method,
      headers: { "Content-Type": "application/json", "x-admin-passcode": sessionStorage.getItem("pc") || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw { code: "NETWORK", message: "Can't reach the server. Check your connection and the API URL." };
  }
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON response */ }
  if (res.status === 401) {
    logout();
    throw { code: "UNAUTHORIZED", message: "Incorrect or missing passcode." };
  }
  if (!res.ok || !json || !json.success) {
    throw (json && json.error) || { code: "SERVER", message: `Unexpected server error (${res.status}).` };
  }
  return json;
}

/* ---------- Forms & validation ---------- */
function buildForm(form, p, foot = "") {
  const field = ([n, l, t]) =>
    `<div class="fld"><label for="${p}-${n}">${l}</label><input id="${p}-${n}" name="${n}" type="${t}"${t === "number" ? ' inputmode="numeric" step="1"' : ""}><small class="ferr" id="${p}-${n}-e"></small></div>`;
  form.innerHTML =
    `<h3>Student details</h3><div class="grid">${FIELDS.map(field).join("")}</div>` +
    `<h3>Marks <span class="mut">(out of 100)</span></h3><div class="grid">${SUBJECTS.map((s, i) => field(["subject" + (i + 1), s, "number"])).join("")}</div>` +
    foot;
}

function collect(p) {
  const g = n => $(`#${p}-${n}`).value.trim();
  const num = n => (g(n) === "" ? NaN : Number(g(n)));
  const d = { rollNumber: g("rollNumber"), studentName: g("studentName"), email: g("email"), course: g("course"), semester: num("semester") };
  for (let i = 1; i <= 5; i++) d["subject" + i] = num("subject" + i);
  return d;
}

function validate(d) {
  const e = {};
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(d.rollNumber)) e.rollNumber = "Use 1–20 letters, digits, - or _";
  if (d.studentName.length < 2 || d.studentName.length > 60) e.studentName = "Enter a name of 2–60 characters";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.email = "Enter a valid email address";
  if (!d.course || d.course.length > 80) e.course = "Enter a course (max 80 characters)";
  if (!Number.isInteger(d.semester) || d.semester < 1 || d.semester > 8) e.semester = "Semester must be a whole number from 1 to 8";
  for (let i = 1; i <= 5; i++) {
    const v = d["subject" + i];
    if (!Number.isInteger(v) || v < 0 || v > 100) e["subject" + i] = "Marks must be a whole number from 0 to 100";
  }
  return e;
}

function showErrors(p, errs = {}) {
  document.querySelectorAll(`[id^="${p}-"][id$="-e"]`).forEach(e => (e.textContent = ""));
  document.querySelectorAll(`[id^="${p}-"]:not([id$="-e"])`).forEach(i => i.classList.remove("invalid"));
  let first = null;
  for (const [k, m] of Object.entries(errs)) {
    const i = $(`#${p}-${k}`), e = $(`#${p}-${k}-e`);
    if (i) { i.classList.add("invalid"); first = first || i; }
    if (e) e.textContent = m;
  }
  if (first) first.focus();
}

/* ---------- Rendering ---------- */
function table(list) {
  const rows = list.map(s => `<tr>
    <td>${esc(s.rollNumber)}</td><td>${esc(s.studentName)}</td><td>${esc(s.course)}</td><td>${esc(s.semester)}</td>
    <td>${esc(s.percentage)}%</td><td>${badge(s.result)}</td>
    <td><button class="lnk" data-act="view" data-id="${esc(s.rollNumber)}">View</button>
        <button class="lnk" data-act="edit" data-id="${esc(s.rollNumber)}">Edit</button>
        <button class="lnk bad" data-act="del" data-id="${esc(s.rollNumber)}" data-name="${esc(s.studentName)}">Delete</button></td></tr>`).join("");
  return `<div class="tw"><table><thead><tr><th>Roll No</th><th>Name</th><th>Course</th><th>Semester</th><th>Percentage</th><th>Result</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- Actions ---------- */
async function loadDashboardStats() {
  try {
    const { data: d } = await apiRequest("GET", "/stats");
    $("#cTotal").textContent = d.total;
    $("#cPass").textContent = d.passed;
    $("#cFail").textContent = d.failed;
    $("#cAvg").textContent = d.averagePercentage + "%";
    $("#recentBox").innerHTML = d.recent.length
      ? d.recent.map(s => `<div class="rec"><div><b>${esc(s.studentName)}</b> <span class="mut">Roll ${esc(s.rollNumber)}</span></div>
          <div>${esc(s.percentage)}% ${badge(s.result)} <button class="lnk" data-act="view" data-id="${esc(s.rollNumber)}">View</button></div></div>`).join("")
      : state("No results yet. Add a student to get started.");
    const keys = ["90-100", "75-89", "60-74", "40-59", "0-39"];
    const mx = Math.max(1, ...keys.map(k => d.distribution[k] || 0));
    $("#distBox").innerHTML = keys.map(k => {
      const n = d.distribution[k] || 0;
      return `<div class="dist"><span>${k}%</span><div class="trk"><i style="width:${(n / mx) * 100}%"></i></div><b>${n}</b></div>`;
    }).join("");
  } catch (e) {
    $("#recentBox").innerHTML = $("#distBox").innerHTML = state(esc(e.message), "errtxt");
    showNotification(e.message, "error");
  }
}

async function loadStudents() {
  const box = $("#studentsBox");
  box.innerHTML = LOADING;
  try {
    const { data } = await apiRequest("GET", "/students");
    box.innerHTML = data.length ? table(data) : state("No students yet. Use Add Student to enter the first result.");
  } catch (e) {
    box.innerHTML = state(esc(e.message), "errtxt");
  }
}

async function searchStudent() {
  const q = $("#searchInput").value.trim(), box = $("#searchBox"), seq = ++searchSeq;
  if (!q) { box.innerHTML = state("Type a roll number or student name to search."); return; }
  box.innerHTML = LOADING;
  try {
    const { data } = await apiRequest("GET", "/students?search=" + encodeURIComponent(q));
    if (seq !== searchSeq) return;
    box.innerHTML = data.length ? table(data) : state(`No students match “${esc(q)}”.`);
  } catch (e) {
    if (seq === searchSeq) box.innerHTML = state(esc(e.message), "errtxt");
  }
}

async function addStudent(ev) {
  ev.preventDefault();
  const d = collect("add"), errs = validate(d);
  showErrors("add", errs);
  if (Object.keys(errs).length) return showNotification("Please fix the highlighted fields.", "error");
  const btn = $("#addSave");
  btn.disabled = true;
  try {
    await apiRequest("POST", "/students", d);
    showNotification(`Added ${d.studentName} (Roll ${d.rollNumber}).`);
    $("#addForm").reset();
    showErrors("add");
    nav("students");
  } catch (e) {
    if (e.code === "DUPLICATE_ROLL_NUMBER") showErrors("add", { rollNumber: e.message });
    else if (e.details) showErrors("add", e.details);
    showNotification(e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function viewStudent(id) {
  try {
    const { data: s } = await apiRequest("GET", "/students/" + encodeURIComponent(id));
    $("#viewCard").innerHTML = `<h2 class="ctitle">Student Result</h2>
      <dl class="info"><dt>Student name</dt><dd>${esc(s.studentName)}</dd><dt>Roll number</dt><dd>${esc(s.rollNumber)}</dd>
      <dt>Email</dt><dd>${esc(s.email)}</dd><dt>Course</dt><dd>${esc(s.course)}</dd><dt>Semester</dt><dd>${esc(s.semester)}</dd></dl>
      <table class="marks"><thead><tr><th>Subject</th><th>Marks</th></tr></thead><tbody>
      ${SUBJECTS.map((n, i) => `<tr><td>${n}</td><td>${esc(s["subject" + (i + 1)])}</td></tr>`).join("")}</tbody></table>
      <div class="sum"><span>Total</span><b>${esc(s.totalMarks)} / 500</b><span>Percentage</span><b>${esc(s.percentage)}%</b><span>Result</span>${badge(s.result)}</div>`;
    $("#viewDlg").showModal();
  } catch (e) {
    showNotification(e.message, "error");
  }
}

async function editStudent(id) {
  try {
    const { data: s } = await apiRequest("GET", "/students/" + encodeURIComponent(id));
    editingId = s.rollNumber;
    KEYS.forEach(k => ($(`#edit-${k}`).value = s[k]));
    showErrors("edit");
    $("#editDlg").showModal();
  } catch (e) {
    showNotification(e.message, "error");
  }
}

async function updateStudent(ev) {
  ev.preventDefault();
  const d = collect("edit"), errs = validate(d);
  showErrors("edit", errs);
  if (Object.keys(errs).length) return showNotification("Please fix the highlighted fields.", "error");
  const btn = $("#editSave");
  btn.disabled = true;
  try {
    await apiRequest("PUT", "/students/" + encodeURIComponent(editingId), d);
    $("#editDlg").close();
    showNotification(`Updated ${d.studentName}.`);
    reload();
  } catch (e) {
    if (e.details) showErrors("edit", e.details);
    showNotification(e.message, "error");
    if (e.code === "NOT_FOUND") { $("#editDlg").close(); reload(); }
  } finally {
    btn.disabled = false;
  }
}

function askDelete(id, name) {
  deletingId = id;
  $("#delText").textContent = `${name} (Roll ${id}) will be permanently removed.`;
  $("#delDlg").showModal();
}

async function deleteStudent() {
  const btn = $("#delConfirm");
  btn.disabled = true;
  try {
    await apiRequest("DELETE", "/students/" + encodeURIComponent(deletingId));
    showNotification("Student deleted.");
  } catch (e) {
    showNotification(e.message, "error");
  } finally {
    btn.disabled = false;
    $("#delDlg").close();
    reload();
  }
}

/* ---------- Wiring ---------- */
buildForm($("#addForm"), "add",
  '<div class="foot"><button type="reset" class="btn">Clear form</button><button class="btn pri" type="submit" id="addSave">Save student</button></div>');
buildForm($("#editForm"), "edit");
$("#edit-rollNumber").readOnly = true;

$("#addForm").addEventListener("submit", addStudent);
$("#addForm").addEventListener("reset", () => showErrors("add"));
$("#editForm").addEventListener("submit", updateStudent);
$("#delConfirm").addEventListener("click", deleteStudent);
$("#printBtn").addEventListener("click", () => window.print());
$("#refreshBtn").addEventListener("click", loadStudents);
$("#logoutBtn").addEventListener("click", logout);

let timer;
$("#searchInput").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(searchStudent, 300); });

$("#loginForm").addEventListener("submit", e => {
  e.preventDefault();
  sessionStorage.setItem("pc", $("#passcode").value);
  $("#login").hidden = true;
  nav("dashboard");
});

document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]");
  if (a) {
    const id = a.dataset.id;
    if (a.dataset.act === "view") viewStudent(id);
    else if (a.dataset.act === "edit") editStudent(id);
    else askDelete(id, a.dataset.name);
    return;
  }
  const n = e.target.closest("[data-nav]");
  if (n) return nav(n.dataset.nav);
  if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
  else if (e.target.tagName === "DIALOG") e.target.close();
});

if (API_BASE_URL.startsWith("YOUR_")) showNotification("Set API_BASE_URL in script.js before using the app.", "error");
if (sessionStorage.getItem("pc")) load("dashboard"); else $("#login").hidden = false;
