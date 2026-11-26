let token = new URLSearchParams(location.hash.slice(1)).get("setup");
history.replaceState(null, "", location.pathname);
if (token) {
  document.getElementById("title").textContent = "ตั้งรหัสผ่านครั้งแรก";
  document.getElementById("desc").textContent =
    "ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร ลิงก์ตั้งค่าใช้ได้ครั้งเดียว และหมดอายุภายใน 24 ชั่วโมง";
  document.getElementById("password").autocomplete = "new-password";
  document.getElementById("password").minLength = 12;
  document.getElementById("confirmWrap").hidden = false;
  document.getElementById("confirm").required = true;
  document.getElementById("submit").textContent = "ตั้งรหัสผ่านและเข้าสู่ระบบ";
}
document.getElementById("login").onsubmit = async (e) => {
  e.preventDefault();
  const b = document.getElementById("submit");
  const password = document.getElementById("password").value;
  if (token && password !== document.getElementById("confirm").value) {
    document.getElementById("error").textContent = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
    return;
  }
  b.disabled = true;
  try {
    const r = await fetch(token ? "/auth/setup" : "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, token }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    token = null;
    location.replace("/");
  } catch (e) {
    document.getElementById("error").textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
