# เริ่มติดตามจากแหล่งสาธารณะโดยไม่ซื้อ Social Listening

เพิ่มแหล่งข้อมูลโดยไม่สมัครผู้ให้บริการแบบเสียเงิน ไม่มีการซื้อโควตา/สมัครแพ็กเกจ/เปิด billing ให้อัตโนมัติ ค่าใช้ Cloudflare เดิมและโควตาของ API แต่ละรายยังคงขึ้นกับบัญชีผู้ใช้

| แหล่ง | สถานะเมื่อ Deploy เวอร์ชันนี้ |
| --- | --- |
| Google News / Bing RSS | ทำงานเหมือนเดิม ไม่มี API key |
| Bluesky | เปิดค้นโพสต์สาธารณะได้โดยไม่ต้องมีบัญชีหรือ key ปิดได้ใน Dashboard |
| YouTube | มี adapter พร้อม แต่จะไม่เรียกจนกว่าจะตั้ง YOUTUBE_API_KEY และเปิดแหล่งนี้ |
| Facebook / Instagram / TikTok / X / Pantip | ยังไม่มีการเชื่อม API โดยตรง ไม่ได้แสดงว่าเชื่อมสำเร็จ ต้องมีสิทธิ์/บัญชี/บริการที่แพลตฟอร์มรองรับเพิ่มเติม |

ข้อมูลที่ค้นพบบน RSS ไม่เท่ากับการเข้าถึงโพสต์ทั้งหมดของโซเชียล ไม่มีการ scrape กลุ่มปิดหรือใช้บริการ proxy แบบเสียเงิน

## Bluesky

เรียก `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts` แบบไม่ใส่ Authorization ค้นคำที่ตั้งไว้รวมด้วย OR, sort latest, ย้อนหลัง 7 วัน, หน้าละไม่เกิน 100 โพสต์ต่อรอบ ไม่มี pagination ต่อเนื่องใน adapter รุ่นนี้ จึงอาจพลาดข้อมูลเมื่อมีผลลัพธ์มากเกินเพดาน

ตรวจ endpoint จริงจากเครื่องพัฒนาสำเร็จ (HTTP 200) วันที่ 2026-11-27 ส่วน cached host `public.api.bsky.app` ตอบ 403 สำหรับ search ในการทดสอบ จึงเลือก AppView host `api.bsky.app` ที่ตอบได้ การเข้าถึงอาจเปลี่ยนตามผู้ให้บริการ/โควตา/IP ไม่ใช่ SLA

รายการใหม่ใช้ AT URI เป็น key กันซ้ำ สร้างลิงก์กลับไปอ่านโพสต์ต้นฉบับบน bsky.app และใช้ outbox/Sentiment/ตารางเวลาเดิม คำย่อ SiPH เพียงอย่างเดียวต้องมีบริบทโรงพยาบาล/บริการร่วมด้วย เพื่อกัน SiPh ที่หมายถึง silicon photonics หรือชื่อบัญชีอื่น ส่วนคำค้นชื่อเต็มยังจับตามคำที่ตั้งไว้ ผลกรองอาจมี false positive/false negative ทีมงานควรตรวจต้นฉบับ

สถานะแหล่งข้อมูลใน Dashboard หมายถึงเปิดใช้งาน/มี credentials ครบ ไม่รับประกันว่าค้นสำเร็จทุกครั้ง ให้ดูผลจริงและ error ในประวัติตรวจข่าว

อ้างอิง: [Bluesky API](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts), [API hosts](https://docs.bsky.app/docs/advanced-guides/api-directory)

## YouTube — ใช้ key ขององค์กร ภายในโควตาที่บัญชีได้รับ

1. เปิด Google Cloud Console ด้วยบัญชีที่องค์กรอนุญาต
2. สร้างหรือเลือก project และเปิด **YouTube Data API v3**
3. ไป **APIs & Services → Credentials → Create credentials → API key**
4. จำกัด key ให้ใช้เฉพาะ YouTube Data API v3 และเลือก application restrictions ให้ตรงกับการเรียกจาก backend; HTTP-referrer restrictions สำหรับ browser ใช้กับ Worker ไม่ได้
5. นำ key ไปใส่ใน Cloudflare Worker `siph-monitor` → Settings → Variables and Secrets → เพิ่มชนิด **Secret** ชื่อ `YOUTUBE_API_KEY` ห้ามส่ง key ในแชต/PR หรือใส่ GitHub
6. เผยแพร่การเปลี่ยน Secrets ตามขั้นตอน Cloudflare และเปิดแหล่ง YouTube ใน Dashboard แล้วตรวจประวัติรอบจริง

เรียก `search.list` ครั้งเดียวต่อรอบเมื่อเปิดใช้และมี key โดยรวมคำค้นเป็น OR ค้นเฉพาะ public videos ย้อนหลัง 7 วัน สูงสุด 50 รายการ ไม่อ่าน transcript/เสียงพูด/ความคิดเห็นทั้งหมด ส่ง key ผ่าน `X-Goog-Api-Key` header ไม่ใส่ใน URL หรือบันทึก log และไม่ใช้ key ของผู้อื่น

เอกสาร Google ณ 2026-11-27 ระบุ default search quota 100 calls/day แยก bucket ของ search; ตรวจโควตาจริงที่ project ขององค์กรอีกครั้ง วันทำงานตามตารางปกติมี 12 รอบ และวันหยุดมี 6 รอบ การกดตรวจเองเพิ่มจำนวน calls ไม่มีการขยายโควตาหรือซื้อเครดิตอัตโนมัติ

เก็บเฉพาะ metadata และลิงก์ ไม่ดาวน์โหลดวิดีโอ ตัวแอปเป็นผู้จัดหมวด/ติดตามประเด็นเอง ไม่ใช่คะแนนหรือการรับรองจาก YouTube ผู้ดูแลต้องตรวจเงื่อนไขการใช้ข้อมูลและ analytics use case ของโครงการก่อนเปิดแหล่งนี้ API metadata ของ YouTube และคิวที่เกี่ยวข้องจะถูกลบเมื่อเกิน 29 วันใน scheduled cleanup เพื่อไม่เก็บถาวรโดยไม่ refresh แหล่งอื่นและบัญชีผู้ดูแลไม่ถูกลบ

การเพิ่ม key ยังไม่เท่ากับทดสอบสำเร็จ จนกว่าจะตรวจผล HTTP/ประวัติด้วย project และ key จริง งานพัฒนาไม่ได้สร้าง Google Cloud project หรือเปิดบัญชี API ให้ผู้ใช้

อ้างอิง: [การสร้าง credentials](https://developers.google.com/youtube/data/guides/authentication), [Search API](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [Quota](https://developers.google.com/youtube/data/determine_quota_cost), [Developer policies](https://developers.google.com/youtube/terms/developer-policies)
