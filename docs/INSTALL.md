# การติดตั้งและอัปเกรด

## 1. ตรวจเป้าหมายและสำรองข้อมูล

Repository: `Merp071/siph-monitor`; Worker เดิม `siph-monitor`; D1 เดิม `siph-monitor-db` binding `DB` IDs ที่ตรวจแล้วอยู่ใน `config/cloudflare.json` IDs ไม่ใช่ API keys หากย้ายบัญชีให้แก้ config ผ่าน PR แยก

ตรวจ schema และสำรอง D1 จาก Cloudflare dashboard (Export/Time Travel ตามแพ็กเกจ) ก่อนเปลี่ยนระบบ ใช้ฐานข้อมูลทดสอบแยกหากทำ staging ห้ามชี้ tests ไป production

Schema เวอร์ชันนี้ตรงกับตารางเดิม ไม่ต้อง reset, re-import, ลบตาราง หรือสร้าง D1 ใหม่ โดยเฉพาะ `auth`, `sessions`, `articles` และ `deliveries` ต้องคงไว้

`0001_existing_schema.sql` เป็น baseline แบบ idempotent สำหรับ adoption/fresh initialization ไม่ใช่คำสั่งล้างข้อมูล หากจำเป็นต้องเริ่ม schema ด้วยบัญชี admin จริง สคริปต์นี้ต้องได้รับการรีวิวก่อน:

```sh
node scripts/init-db.mjs --confirm=siph-monitor-db
```

สคริปต์อ่าน `CLOUDFLARE_API_TOKEN` จาก environment เครื่องผู้ดูแล ต้องมีสิทธิ์ Workers Scripts Write และ D1 Write ตามงานที่ทำ ห้ามใส่ token ใน source, shell history หรือไฟล์ที่ Git ติดตาม ใช้ secret manager/secure environment ขององค์กร ไม่ต้องให้ Cloudflare token กับหน้าเว็บหรือ Worker

## 2. ตั้ง Cloudflare Workers Secrets

ใน Cloudflare dashboard เลือก Worker → Settings → Variables and Secrets → Add → **Secret**:

| Secret | ใช้ทำอะไร |
| --- | --- |
| `RESEND_API_KEY` | ส่งอีเมลผ่าน Resend HTTPS API |
| `EMAIL_FROM` | อีเมลผู้ส่งที่ยืนยันโดเมนกับ Resend แล้ว |
| `LINE_CHANNEL_ACCESS_TOKEN` | ส่ง push ด้วย LINE Official Account / Messaging API |
| `SOCIAL_FEED_URL` | HTTPS endpoint ของ social listening ที่องค์กรมีสิทธิ์ใช้ |
| `SOCIAL_FEED_TOKEN` | Bearer token สำหรับ endpoint นั้น |
| `GOOGLE_ALERTS_FEEDS` | JSON array ของ Google Alerts RSS/Atom ส่วนตัว สูงสุด 10 feeds ดู [วิธีตั้งค่า](GOOGLE_ALERTS.md) |
| `YOUTUBE_API_KEY` | YouTube public-video search ภายในโควตาบัญชี ดู FREE_SOURCES.md |

ไม่จำเป็นต้องตั้งทุกช่อง แหล่งข่าว RSS ใช้งานได้โดยไม่ต้องมี API key สถานะ Dashboard แสดงเฉพาะว่ามีการตั้งค่า ไม่ส่งค่า secret กลับ API

Dashboard เวอร์ชันเดิมเคยเก็บ integration แบบเข้ารหัสใน D1 ตาราง `integrations` เวอร์ชันนี้จะไม่อ่าน/เขียนตารางนั้นแล้ว หากองค์กรเคยตั้งค่าต้องย้ายค่าผ่านผู้ดูแลเข้ามาใน Workers Secrets ก่อนสลับเวอร์ชัน การตรวจล่าสุดพบ legacy integrations 0 รายการ จึงยังไม่มีค่าที่ต้องย้าย การตรวจนี้อ่านเฉพาะจำนวน ไม่ดึงค่า credential

คง `CREDENTIAL_KEY` เดิมไว้เพื่อ rollback ไปเวอร์ชันเก่าได้ สคริปต์ Deploy inherit ทุก Secret ของ Worker เดิม ห้ามคัดลอก key นี้ลง GitHub เวอร์ชันใหม่ไม่ใช้ key นี้ถอดรหัส integration อีกแล้ว

## 3. ทดสอบและเปิด Pull Request

```sh
npm ci
npm run check
npm test
npm run test:runtime
npm run build
```

Push สาขา feature แล้วเปิด PR เข้า `main` ให้ผู้ดูแลตรวจโค้ด/Secrets/schema พร้อม CI ก่อน merge ไม่มีขั้นตอน Deploy บน push หรือ pull_request และ CI ไม่ต้องใช้ Cloudflare API token

## 4. Deploy หลังรีวิวและ merge เท่านั้น

Checkout commit ที่ GitHub merge PR นั้นจริง และตรวจ working tree ให้สะอาด:

```sh
git switch main
git pull --ff-only
npm ci
npm test
npm run test:runtime
npm run check
npm run deploy -- --pr <หมายเลข-PR-ที่-merge-แล้ว>
```

สคริปต์จะตรวจ PR ผ่าน GitHub API: repository และ base branch ต้องตรง, `merged=true`, checkout SHA ต้องเท่ากับ `merge_commit_sha` ทุกประการ มิฉะนั้นจะปฏิเสธก่อนเรียก Cloudflare API จากนั้น build จาก source ที่ตรวจแล้ว, ตรวจ binding `DB` ว่าตรงกับ D1 เดิม, inherit Secrets แล้ว upload Worker และยืนยัน cron อีกครั้ง ไม่มีการ reset schema หรือรีเซ็ตบัญชีผู้ดูแลในขั้น Deploy

หากมี binding อื่นที่ไม่ได้รีวิว สคริปต์จะหยุดแทนที่จะลบทิ้ง หากตรวจ GitHub ไม่ได้ (เช่น rate limit/เครือข่าย) จะหยุดโดยไม่ Deploy ห้ามเลี่ยง gate โดยแก้สคริปต์นอก PR

ถ้า upload สำเร็จแต่ตั้ง cron ไม่สำเร็จ อาจมีเวอร์ชันใหม่ทำงานแล้ว ต้องตรวจ Workers dashboard ก่อน retry ไม่ถือว่าข้อผิดพลาดแปลว่ายังไม่มีการเปลี่ยนแปลงเสมอไป

## 5. เข้าสู่ระบบและเปิดแจ้งเตือน

บัญชีและรหัสผ่านเดิมยังใช้ได้ ไม่ต้องสร้างลิงก์ผู้ดูแลใหม่ สำหรับฐานข้อมูลใหม่ที่ยังไม่มีรหัสผ่านเท่านั้น ตั้ง `SIPH_ORIGIN` เป็น HTTPS origin ของแอป และรัน:

```sh
node scripts/setup-admin.mjs --create-one-use-link
```

ใช้ลิงก์ที่สคริปต์แสดงเพื่อตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร ลิงก์ใช้ได้ครั้งเดียวใน 24 ชั่วโมง ห้ามแชร์ลิงก์ใน issue/PR/GitHub Actions logs สคริปต์ไม่เปลี่ยนรหัสผ่านที่ตั้งไว้แล้ว

ใน Dashboard ตั้งอีเมลผู้รับหนึ่งอีเมล, LINE User ID หรือ Group ID, หมวดที่ต้องแจ้งเตือน และเปิดแต่ละช่องทาง ผู้รับ LINE ต้องเพิ่มเพื่อน OA หรือเชิญ OA เข้ากลุ่ม และบัญชีต้องมีสิทธิ์/โควตา การกรอก LINE display name แทน ID ใช้ไม่ได้ ไม่ใช้ LINE Notify ที่ยุติบริการแล้ว

กดตรวจข่าวและตรวจ history ของ collector กับ outbox แยกกัน ทดสอบ push จริงกับผู้รับที่องค์กรอนุญาต การที่ API รับข้อความไม่ยืนยันว่าผู้ใช้ได้อ่าน

## Rollback

เก็บเวอร์ชัน Worker เดิมและสำรอง D1 ก่อนปล่อย ใช้ Workers Versions dashboard ย้อนกลับ code version ได้ โดยไม่ลบฐานข้อมูลหรือ Secrets การ rollback code ไม่ย้อนคืนข้อมูลใน D1 อ่านคู่มือ Time Travel/Export ของแพ็กเกจให้ตรงกับเหตุการณ์ก่อนกู้ข้อมูลจริง

## แหล่งฟรีที่เพิ่ม

Bluesky เปิดใช้ได้โดยไม่ต้องซื้อบริการหรือมี key; YouTube ต้องมี key ขององค์กรก่อนจึงเรียก ทั้งสองปิด/เปิดใน Dashboard ได้โดยไม่เปลี่ยน schema ข้อมูลเดิม ดู [คู่มือแหล่งฟรี](FREE_SOURCES.md) สำหรับข้อจำกัด โควตา และการเก็บ metadata ของ YouTube
