# Social Listening API contract

ต้องใช้ผู้ให้บริการที่องค์กรอนุญาตให้เข้าถึงข้อมูล ไม่ scrape กลุ่มปิดหรือข้ามสิทธิ์ Facebook/X/Instagram/TikTok/YouTube/Pantip ไม่ได้เชื่อมต่อครบเองด้วยการตั้ง URL ทั่วไป ต้องจัด adapter ให้ตรงกับ API ของผู้ให้บริการจริง

Worker เรียก `GET SOCIAL_FEED_URL` พร้อม `Authorization: Bearer SOCIAL_FEED_TOKEN` ค่า URL และ token ต้องตั้งเป็น Cloudflare Secrets เพื่อไม่เปิดเผย endpoint ภายในหรือรหัสลับ

รับ JSON array หรือ `{ "data": [...] }`:

```json
{
  "data": [
    {
      "title": "ประสบการณ์รับบริการ SiPH",
      "text": "ขอบคุณทีมงานที่ดูแลดี",
      "url": "https://social.example.org/posts/123",
      "source": "Facebook",
      "published": "2026-11-26T10:00:00+07:00"
    }
  ]
}
```

`title` หรือ `text` อย่างน้อยหนึ่งอย่างต้องเป็น string; ถ้ามีแต่ text จะใช้ 240 ตัวแรกเป็นหัวข้อ `url` ต้องเป็น HTTPS ที่ไม่มี username/password และใช้กันข่าวซ้ำหลังตัด fragment รองรับ `platform` แทน `source` ได้ คัดเฉพาะรายการที่ title/text มีคำค้นที่ตั้งไว้ จำกัด 500 รายการและ response 3 MB ต่อรอบ timeout 20 วินาที ไม่ตาม redirect เพื่อไม่ส่ง Bearer token ไปปลายทางอื่น

ยังไม่ทำ pagination เฉพาะผู้ให้บริการ หาก API คืนหลายหน้าหรือต้องมี query/body แบบเฉพาะ ให้แก้ collector ผ่าน PR หรือจัด aggregation endpoint ที่รวมรายการช่วงเวลาที่ต้องการและส่งตาม contract นี้ ห้ามนำ API key ไปใส่ใน query string หรือ frontend

ความผิดพลาดของ Social API ไม่ทำให้ข่าว RSS ที่ดึงสำเร็จหายไป ประวัติขึ้น “สำเร็จบางแหล่ง” และบอกแหล่งที่มีปัญหา โดยไม่บันทึก response body ของผู้ให้บริการลงข้อความ error
