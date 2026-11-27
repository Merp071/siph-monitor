const $ = (id) => document.getElementById(id);
let state = {
    articles: [],
    runs: [],
    deliveries: [],
    settings: {},
    connections: {},
  },
  selected = null;
const names = { positive: "เชิงบวก", negative: "เชิงลบ", neutral: "เป็นกลาง" },
  colors = { positive: "#269a80", negative: "#d66b70", neutral: "#8ba7c6" };
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s) =>
  s
    ? new Date(s).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function toast(s) {
  $("toast").textContent = s;
  $("toast").hidden = false;
  setTimeout(() => ($("toast").hidden = true), 4500);
}
async function api(path, data) {
  const r = await fetch(
    "/api/" + path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  if (r.status === 401) {
    location.replace("/login");
    throw Error("กรุณาเข้าสู่ระบบ");
  }
  if (!r.ok) throw Error((await r.json()).error || "เชื่อมต่อไม่สำเร็จ");
  return r.json();
}
function page(id) {
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== id));
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  $("pageTitle").textContent = {
    overview: "ภาพรวมการติดตาม",
    mentions: "ข่าวและการกล่าวถึง",
    settings: "ตารางเวลาและแจ้งเตือน",
    history: "ประวัติการทำงาน",
  }[id];
}
document
  .querySelectorAll("[data-page]")
  .forEach((b) => (b.onclick = () => page(b.dataset.page)));
document
  .querySelectorAll("[data-open]")
  .forEach((b) => (b.onclick = () => page(b.dataset.open)));
function empty(title, subtitle) {
  return (
    '<div class="empty"><div class="empty-icon">◫</div><b>' +
    esc(title) +
    "</b><p>" +
    esc(subtitle) +
    "</p></div>"
  );
}
function cards(list) {
  if (!list.length)
    return empty(
      "ยังไม่มีข่าวในรายการนี้",
      "กด “ตรวจข่าวตอนนี้” เพื่อค้นหาข่าว หรือปรับตัวกรองเพื่อดูรายการอื่น",
    );
  return list
    .map(
      (a) =>
        '<article class="article"><div class="article-icon">▤</div><div class="article-content"><div class="article-meta"><b>' +
        esc(a.source) +
        "</b><span>•</span><span>" +
        esc(date(a.found)) +
        '</span><span class="badge ' +
        esc(a.sentiment) +
        '">' +
        esc(names[a.sentiment]) +
        "</span></div><h3>" +
        esc(a.title) +
        '</h3><div class="article-meta"><span>' +
        esc(
          { new: "ยังไม่ตรวจสอบ", reviewing: "กำลังติดตาม", done: "ดำเนินการแล้ว" }[
            a.status
          ],
        ) +
        '</span><span>·</span><span>จัดหมวดหมู่เบื้องต้นอัตโนมัติ</span></div></div><button data-detail="' +
        esc(a.id) +
        '">ตรวจสอบ</button></article>',
    )
    .join("");
}
function bindCards() {
  document.querySelectorAll("[data-detail]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = state.articles.find((a) => a.id === b.dataset.detail);
        $("detailTitle").textContent = selected.title;
        $("detailReason").textContent = selected.reason;
        const u = new URL(selected.url);
        $("detailLink").href = u.protocol === "https:" ? u.href : "#";
        $("detailSentiment").value = selected.sentiment;
        $("detailStatus").value = selected.status;
        $("articleDialog").showModal();
      }),
  );
}
function renderArticles() {
  const q = $("search").value.toLocaleLowerCase();
  const list = state.articles.filter(
    (a) =>
      (a.title + " " + a.source).toLocaleLowerCase().includes(q) &&
      ($("filter").value === "all" || a.sentiment === $("filter").value) &&
      ($("statusFilter").value === "all" ||
        a.status === $("statusFilter").value),
  );
  $("allArticles").innerHTML = cards(list);
  $("recent").innerHTML = cards(state.articles.slice(0, 4));
  bindCards();
}
function render(fillSettings) {
  const n = state.stats?.total ?? state.articles.length;
  $("navCount").textContent = n;
  $("total").textContent = n;
  $("donutTotal").textContent = n;
  let acc = 0,
    stops = [];
  $("legend").innerHTML = Object.keys(names)
    .map((k) => {
      let c =
          state.stats?.[k] ??
          state.articles.filter((a) => a.sentiment === k).length,
        p = n ? (c / n) * 100 : 0;
      $(k).textContent = c;
      stops.push(colors[k] + " " + acc + "% " + (acc + p) + "%");
      acc += p;
      return (
        '<div><i style="background:' +
        colors[k] +
        '"></i>' +
        names[k] +
        "<b>" +
        c +
        "</b><span>" +
        Math.round(p) +
        "%</span></div>"
      );
    })
    .join("");
  $("donut").style.background = n
    ? "conic-gradient(" + stops.join(",") + ")"
    : "#e5eaf0";
  $("monitorState").textContent = state.settings.paused
    ? "พักการตรวจอัตโนมัติ"
    : "เปิดการตรวจข่าวอัตโนมัติ";
  $("nextRun").textContent = state.settings.paused
    ? "หยุดชั่วคราว จนกว่าจะเปิดการตรวจอัตโนมัติ"
    : "รอบถัดไป " + date(state.next) + " น.";
  renderArticles();
  if (fillSettings) {
    for (const k of ["email_to", "line_to"])
      $(k).value = state.settings[k] || "";
    for (const k of ["email_enabled", "line_enabled", "paused"])
      $(k).checked = !!state.settings[k];
    $("keywords").value = (state.settings.keywords || []).join("\n");
    $("holidays").value = (state.settings.holidays || []).join("\n");
    document
      .querySelectorAll("[name=sentiments]")
      .forEach(
        (c) =>
          (c.checked = (state.settings.alert_sentiments || []).includes(
            c.value,
          )),
      );
  }
  $("emailBadge").textContent = state.connections.email
    ? "พร้อมเชื่อมต่อ"
    : "ยังไม่ตั้งค่า Resend";
  $("lineBadge").textContent = state.connections.line
    ? "มี token แล้ว"
    : "ยังไม่ตั้งค่า token";
  $("sources").innerHTML = [
    [
      "Google News / Bing RSS",
      "news",
      "ค้นหาข่าวออนไลน์ · Bing เป็นแหล่งสำรองเมื่อ Google ไม่พร้อม",
    ],
    [
      "Social listening API",
      "social",
      "Facebook / X / YouTube / อื่น ๆ ตามสิทธิ์ของผู้ให้บริการ",
    ],
  ]
    .map(
      ([s, k, h]) =>
        '<div class="connection-item"><div>' +
        s +
        '<div class="muted">' +
        h +
        '</div></div><span class="tag">' +
        (state.connections[k] ? "ตั้งค่าแล้ว" : "ยังไม่เชื่อมต่อ") +
        "</span></div>",
    )
    .join("");
  $("runHistory").innerHTML = state.runs.length
    ? state.runs
        .map(
          (r) =>
            '<div class="history-row"><b>' +
            esc(date(r.started)) +
            '</b><span class="' +
            (r.status === "success" ? "green" : "red") +
            '">' +
            (r.status === "success"
              ? "สำเร็จ · เพิ่ม " + r.added + " ข่าว"
              : r.status === "partial"
                ? "สำเร็จบางแหล่ง · เพิ่ม " + r.added + " ข่าว"
                : "ตรวจไม่สำเร็จ") +
            "</span><span>" +
            esc(r.message) +
            "</span></div>",
        )
        .join("")
    : empty("ยังไม่มีประวัติตรวจข่าว", "ระบบจะบันทึกผลหลังการตรวจข่าวครั้งแรก");
  $("deliveryHistory").innerHTML = state.deliveries.length
    ? state.deliveries
        .map(
          (d) =>
            '<div class="history-row"><b>' +
            esc(d.channel.toUpperCase()) +
            "</b><span>" +
            esc(
              {
                sent: "ส่งสำเร็จ",
                pending: "รอส่ง / รอลองใหม่",
                failed: "ส่งไม่สำเร็จครบจำนวนครั้ง",
              }[d.status],
            ) +
            "</span><span>ลองแล้ว " +
            d.attempts +
            " ครั้ง " +
            esc(d.error || "") +
            "</span></div>",
        )
        .join("")
    : empty("ยังไม่มีการส่งแจ้งเตือน", "เปิดช่องทางและกำหนดผู้รับในหน้าตั้งค่า");
}
async function load(fill = false) {
  try {
    state = await api("state");
    $("connectionError").hidden = true;
    render(fill);
  } catch (e) {
    $("connectionError").hidden = false;
    $("monitorState").textContent = "ยังไม่เชื่อมต่อเซิร์ฟเวอร์";
    $("nextRun").textContent = "ยังไม่มีการตรวจข่าว";
    $("recent").innerHTML = empty(
      "ยังไม่เชื่อมต่อข้อมูลจริง",
      "เปิดโปรแกรมบนเซิร์ฟเวอร์เพื่อเริ่มติดตามข่าว",
    );
    $("allArticles").innerHTML = $("recent").innerHTML;
  }
}
$("scan").onclick = async () => {
  const b = $("scan");
  b.disabled = true;
  b.textContent = "กำลังตรวจข่าว…";
  try {
    const r = await api("scan", {});
    toast(
      r.error ||
        (r.busy
          ? "มีการตรวจข่าวกำลังทำงานอยู่"
          : "ตรวจเสร็จแล้ว พบข่าวใหม่ " + r.added + " รายการ"),
    );
    await load();
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
    b.textContent = "⟳  ตรวจข่าวตอนนี้";
  }
};
["search", "filter", "statusFilter"].forEach((id) =>
  $(id).addEventListener(id === "search" ? "input" : "change", renderArticles),
);
$("settingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const cfg = {};
  for (const k of ["email_to", "line_to"]) cfg[k] = $(k).value;
  for (const k of ["email_enabled", "line_enabled", "paused"])
    cfg[k] = $(k).checked;
  for (const k of ["keywords", "holidays"])
    cfg[k] = $(k)
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  cfg.alert_sentiments = [
    ...document.querySelectorAll("[name=sentiments]:checked"),
  ].map((x) => x.value);
  try {
    await api("settings", cfg);
    toast("บันทึกการตั้งค่าแล้ว");
    await load(true);
  } catch (e) {
    toast(e.message);
  }
};
$("closeDialog").onclick = () => $("articleDialog").close();
$("articleForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("article", {
      id: selected.id,
      status: $("detailStatus").value,
      sentiment: $("detailSentiment").value,
    });
    $("articleDialog").close();
    await load();
    toast("บันทึกการตรวจสอบแล้ว");
  } catch (e) {
    toast(e.message);
  }
};
$("today").textContent = new Date().toLocaleDateString("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "long",
  year: "numeric",
});
load(true);
setInterval(() => load(), 60000);

$("logout").onclick = async () => {
  await fetch("/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  location.replace("/login");
};
$("retry").onclick = async () => {
  try {
    await api("retry", {});
    toast("นำรายการกลับเข้าคิวแล้ว ระบบจะส่งในรอบประมวลผลถัดไป");
    await load();
  } catch (e) {
    toast(e.message);
  }
};
