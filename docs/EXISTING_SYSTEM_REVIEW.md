# ผลตรวจระบบเดิม (2026-11-26)

ตรวจแบบ read-only ก่อนพัฒนา ไม่เรียก Deploy ไม่เปลี่ยน cron, Secrets, รหัสผ่าน หรือข้อมูล production

- Repository `Merp071/siph-monitor` เริ่มต้นว่าง ไม่มี source/AGENTS.md หรือ CI ให้สืบทอด ผู้ใช้อนุญาตเฉพาะ README/.gitignore เป็น baseline บน main เพื่อเปิด PR
- ตรวจ source ของ Worker ที่ publish แล้วผ่าน Cloudflare API ยืนยันมี Google/Bing RSS, Resend, LINE และ fetch/scheduled handlers
- Source เดิมมี AES-GCM และอ่านตาราง `integrations`; runtime binding ที่ตรวจพบมี `DB` และ Secret `CREDENTIAL_KEY`
- ตรวจ binding `DB` ยืนยันว่าชี้ `siph-monitor-db` ตาม database ID ใน config โซนข้อมูล APAC
- Cron เดิมเป็น `*/5 * * * *` ทำหน้าที่ปลุก scheduler/outbox ไม่ใช่ตรวจข่าวทุก 5 นาที
- ณ snapshot ที่ตรวจ พบ articles 2, runs 8, deliveries 0, legacy integrations 0 ตรวจเฉพาะ counts/schema ไม่ส่งออกข้อมูลผู้รับ ข่าว รหัสผ่าน sessions หรือค่า credential มาใน repo

## Schema เดิมที่รองรับต่อ

`articles`, `auth`, `auth_attempts`, `deliveries`, `integrations`, `locks`, `runs`, `sessions`, `settings` และ indexes เดิมอยู่ใน `db/migrations/0001_existing_schema.sql` ไม่จัดการตาราง internal ของ Cloudflare เช่น `_cf_KV`

ไม่มีการเปลี่ยน column ที่จำเป็นต่อข้อมูลเดิมใน PR นี้ ตาราง integration เดิมคงไว้เพื่อความเข้ากันได้/rollback แต่ไม่ถูกอ่าน/เขียนโดย application เวอร์ชันใหม่

## จุดที่แก้

1. ย้าย API keys ไป Secrets bindings โดยตรงและยกเลิก endpoint รับ secrets จาก Dashboard
2. ปรับ Thai negation/mixed sentiment และระบุว่าเป็น rule-based triage ให้ทีมงานตรวจบริบท
3. Social adapter รองรับ text-only posts, JSON envelope, malformed entries และแยก partial failures
4. ส่ง outbox ผ่าน scheduled lifetime แทน HTTP waitUntil ที่อาจจบก่อนส่งครบ
5. กรองช่องทางที่ปิดก่อน LIMIT เพื่อไม่ให้ backlog ขวางช่องทางที่เปิด
6. LINE 409 ถือว่าส่งแล้วเฉพาะเมื่อมี `x-line-accepted-request-id`
7. ยอด Dashboard คำนวณจาก D1 ทั้งหมด ไม่ใช่แค่ 1,000 records ที่แสดง
8. Error ที่ไม่คาดหมายไม่เปิดเผย SQL/provider body ต่อผู้เรียก API
9. เพิ่ม baseline-adoption tests, Workers runtime tests, secret scan และ CI ที่ไม่ Deploy

ข้อจำกัดของระบบเดิมและเวอร์ชันนี้: เป็นผู้ดูแลร่วมหนึ่งบัญชี ไม่ใช่ RBAC หลายผู้ใช้; การค้นหาขึ้นกับ indexing ของแหล่งข่าว; วันหยุดต้องตั้งเอง และ dedup ข้าม GUID/URL ที่ต่างกันยังไม่ใช่การเทียบเนื้อหาทั้งบทความ
