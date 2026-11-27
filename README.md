# SiPH Media Monitoring

ระบบติดตามการกล่าวถึงโรงพยาบาลศิริราช ปิยมหาราชการุณย์ (SiPH) สำหรับงานสื่อสารองค์กร บน Cloudflare Workers + D1 พร้อม Dashboard ภาษาไทยและคิวแจ้งเตือน Email/LINE

โค้ดชุดนี้เตรียมให้ตรวจผ่าน **Pull Request ก่อน Deploy** ไม่มี workflow ที่ Deploy อัตโนมัติ การรันทดสอบไม่อ่านหรือเขียนฐานข้อมูล production และไม่ส่งข้อความจริง

## ความสามารถ

- Google News RSS และ Bing News RSS สำรองเมื่อแหล่งหลักมีปัญหา ค้นหาชื่อไทย/อังกฤษและ `SiPH` ที่แก้ไขได้
- Bluesky public search ไม่ต้องมี API key และ YouTube public-video adapter เมื่อมี `YOUTUBE_API_KEY` ขององค์กร ดู [การเริ่มต้นแบบฟรี](docs/FREE_SOURCES.md)
- Social Listening API ผ่าน HTTPS/Bearer token รองรับข้อความโพสต์และรูปแบบข้อมูลตาม [สัญญา API](docs/SOCIAL_API.md) ไม่ครอบคลุมโพสต์ส่วนตัวหรือกลุ่มปิดโดยไม่มีสิทธิ์
- Sentiment บวก/ลบ/กลางจากคำสำคัญภาษาไทย/อังกฤษ พร้อมจัดการคำปฏิเสธเบื้องต้นและข้อความที่มีทั้งบวก/ลบ ทีมงานแก้หมวดและสถานะการติดตามได้ ไม่ใช่โมเดล AI หรือการตรวจข้อเท็จจริง
- ข่าวซ้ำใช้ GUID/URL เป็นตัวระบุ คิว Email (Resend) และ LINE Messaging API มี retry สูงสุด 5 ครั้ง, backoff และ idempotency key
- Dashboard แสดงยอดรวมจาก D1, ข่าวล่าสุด, ตัวกรอง, ค้นหา, CSV และประวัติการทำงาน
- หน้าจัดการต้องเข้าสู่ระบบ เซสชัน HttpOnly/Secure/SameSite, ป้องกัน cross-origin writes และจำกัดการลองรหัสผ่าน
- API keys อ่านจาก **Cloudflare Workers Secrets เท่านั้น** ไม่รับผ่าน Dashboard ไม่บันทึกลง D1 หรือ GitHub

## ตารางตรวจข่าว เวลาไทย Asia/Bangkok

| ช่วงเวลา | รอบค้นหาข่าว |
| --- | --- |
| จันทร์–ศุกร์ 08:30–ก่อน 16:30 | 08:30, 09:30, …, 15:30 |
| นอกเวลาราชการในวันทำงาน | 16:30, 20:30, 00:30, 04:30 |
| เสาร์–อาทิตย์ และวันหยุดที่ตั้งค่า | 00:30, 04:30, 08:30, 12:30, 16:30, 20:30 |

Cron `*/5 * * * *` ปลุก Worker ทุก 5 นาทีเพื่อตรวจว่าถึงรอบค้นหาข่าวหรือมีคิวแจ้งเตือนที่ต้องส่งหรือไม่ **ไม่ได้ค้นหาข่าวทุก 5 นาที** รอบที่ตรวจแล้วเก็บใน D1 เพื่อกันซ้ำหลังรีสตาร์ต คิวส่งได้สูงสุด 5 รายการต่อการปลุกหนึ่งครั้ง ส่งครั้งแรกภายในรอบประมวลผลถัดไปประมาณ 5 นาที และช้าลงได้หากมี backlog หรือผู้ให้บริการจำกัดโควตา

วันหยุดเพิ่มเองใน Dashboard ด้วย `YYYY-MM-DD` ปี ค.ศ. ไม่มีปฏิทินวันหยุดไทยอัตโนมัติ Cron อาจคลาดเคลื่อนหรือใช้เวลาประมาณ 15 นาทีจึงรับการตั้งค่าใหม่

## เริ่มต้นพัฒนาและทดสอบ

ใช้ Node.js 24+ และ npm:

```sh
npm ci
npm run check
npm test
npm run test:runtime
npm run build
```

`npm test` สร้าง bundle และทดสอบด้วย SQLite; `test:runtime` ใช้ Miniflare/workerd กับ D1 จริงในเครื่องและ mock แหล่งข่าว/ผู้ส่ง จึงไม่ต้องมี API keys และไม่ส่งข้อความจริง Pin `workerd` รุ่นใหม่ และ dependency ของเครื่องมือทดสอบที่แก้ advisory แล้วใน npm overrides เพื่อให้ runtime ทดสอบรองรับ compatibility date `2026-11-26` ของ Worker

`npm run check` ตรวจ private keys, รูปแบบ token ที่รู้จัก และไฟล์ secret ที่ไม่ควรถูกติดตาม เป็นการตรวจเสริม ไม่แทนการรีวิว diff

## ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `src/worker.mjs` | HTTP auth/API, collector, D1 outbox และ scheduled handler |
| `src/core.mjs` | ตารางเวลา, RSS, Sentiment, validation และ CSV |
| `src/public-social.mjs` | Bluesky/YouTube adapters และตัวกรองบริบทโรงพยาบาล |
| `src/integrations.mjs` | อ่านเฉพาะ Secrets จาก environment binding |
| `web/` | Dashboard และหน้าล็อกอิน |
| `db/migrations/0001_existing_schema.sql` | baseline schema ที่ตรงกับ D1 เดิม ใช้ CREATE IF NOT EXISTS ไม่มี DROP/DELETE |
| `config/cloudflare.json` | IDs ของ Worker/D1 เดิมและ cron; ไม่มีข้อมูลลับ |
| `scripts/deploy.mjs` | ตรวจ PR ที่ merge แล้วและ SHA ก่อนอนุญาตอัปโหลด |
| `.github/workflows/ci.yml` | Tests, runtime checks และ build เท่านั้น |

อ่าน [คู่มือติดตั้งและอัปเกรด](docs/INSTALL.md), [ผลตรวจระบบเดิม](docs/EXISTING_SYSTEM_REVIEW.md) และ [ข้อจำกัด/การดูแล](docs/OPERATIONS.md) ก่อนติดตั้งจริง

## สถานะการส่งมอบ

นี่เป็น source change สำหรับ PR ไม่ใช่หลักฐานว่าเวอร์ชันนี้ Deploy แล้ว การเชื่อมต่อ Email/LINE/Social จริงต้องตั้ง Secrets และทดสอบกับบัญชีและผู้รับที่องค์กรอนุญาตหลังรีวิว โค้ดและ CI ไม่มี API keys จริง
