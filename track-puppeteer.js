// === track-puppeteer.js ===
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
puppeteer.use(StealthPlugin());

// === Kết nối Supabase ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === Tải danh sách tàu ===
const ships = JSON.parse(fs.readFileSync("./ships.json", "utf8"));

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getShipData(ship) {
  console.log(`\n🛰️ Đang lấy dữ liệu cho tàu: ${ship.name}...`);

  const browser = await puppeteer.launch({
    headless: true, // ⚙️ Chạy ẩn trong GitHub Actions
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );

  try {
    const url = `https://www.marinetraffic.com/en/ais/home/shipid:${ship.ship_mt_id}/zoom:10`;
    console.log(`🛰️ Đang truy cập: ${ship.name} (${url})`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });

      // Popup cookie
    try {
      await page.waitForSelector('button[class*="css-1yp8yiu"] span', { timeout: 7000 });
      await page.click('button[class*="css-1yp8yiu"] span');
      console.log("✅ Đã nhấn AGREE để tắt popup cookie.");
    } catch {
      console.log("ℹ️ Không thấy popup cookie.");
    }
    await delay(7000);
      // Di chuột đến icon tàu
    const shipIcons = await page.$$('div.leaflet-marker-icon');
    if (shipIcons.length > 0) {
      const box = await shipIcons[0].boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        console.log("🖱️ Đã di chuột đến icon tàu...");
        await delay(4000);
      }
    }  
    // 🧭 Lấy text toàn trang
    const pageText = await page.evaluate(() => document.body.innerText);

    // === Lấy hành trình ===
    const routeMatch =
      pageText.match(/VN\s+\w+\s+VN\s+\w+/) ||
      pageText.match(/([A-Z]{2,3}\s*[A-Z]{2,3})\s*→\s*([A-Z]{2,3}\s*[A-Z]{2,3})/) ||
      pageText.match(/Route:\s*([A-Z\s\-→]+)/i);

    const atdMatch = pageText.match(/ATD[:\s]*([\d\-:\s]+)/i);
    const etaMatch = pageText.match(/ETA[:\s]*([\d\-:\s]+)/i) || pageText.match(/Reported ETA[:\s]*([\d\-:\s]+)/i);

    const route = routeMatch ? routeMatch[0].trim().replace(/\s+/g, " ") : "Unknown Route";
    const atd = atdMatch ? new Date(atdMatch[1]) : null;
    const eta = etaMatch ? new Date(etaMatch[1]) : null;

    console.log(`🚢 Hành trình: ${route}`);
    console.log(`🕓 ATD: ${atd}`);
    console.log(`🕓 ETA: ${eta}`);

    // === Lấy toạ độ, tốc độ, hướng ===
    const coordMatch = pageText.match(/\(([-+]?\d+\.\d+),\s*([-+]?\d+\.\d+)\)/);
    const speedMatch = pageText.match(/(\d+(?:\.\d+)?)\s*kn/i);
    const headingMatch = pageText.match(/\/\s*(\d{1,3})°/);

    if (!coordMatch) throw new Error("Không tìm thấy tọa độ.");
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;
    const heading = headingMatch ? parseFloat(headingMatch[1]) : 0;

    console.log(`📍 Toạ độ: ${lat}, ${lon}`);
    console.log(`⚡ Tốc độ: ${speed} kn | Hướng: ${heading}°`);

    // === Ghi hành trình (chỉ tạo mới nếu chưa có) ===
    if (route !== "Unknown Route" && atd) {
      const { data: existingTrips, error: tripCheckErr } = await supabase
        .from("trips")
        .select("id")
        .eq("ship_id", ship.id)
        .eq("route", route)
        .eq("departure_date_time", atd.toISOString());

      if (tripCheckErr) throw tripCheckErr;

      if (!existingTrips || existingTrips.length === 0) {
        const tripData = {
          user_id: ship.user_id,
          organization_id: ship.organization_id,
          ship_id: ship.id,
          ship_name: ship.name,
          route,
          departure_date_time: atd.toISOString(),
          eta: eta ? eta.toISOString() : null,
          created_at: new Date().toISOString(),
        };

        console.log("🧾 Dữ liệu gửi lên trips:", tripData);

        const { error: insertTripErr } = await supabase.from("trips").insert([tripData]);
        if (insertTripErr) throw new Error("Lỗi khi ghi trips: " + insertTripErr.message);
        else console.log("✅ Đã ghi hành trình mới vào trips");
      } else {
        console.log("ℹ️ Hành trình đã tồn tại, không ghi lại.");
      }
    }
    //=========test thử tự động chụp chính xác vùng ảnh=====
    // === 5️⃣ Chụp ảnh vùng popup tàu ===
const screenshotPath = `./${VESSEL_NAME.replace(/\s+/g, "_")}_popup.png`;

try {
  // Thử tìm vùng popup thật
  const popup = await page.$('div.leaflet-popup-content');
  if (popup) {
    const box = await popup.boundingBox();
    if (box) {
      await page.screenshot({
        path: screenshotPath,
        clip: {
          x: box.x - 15, // thêm viền nhẹ để không cắt chữ
          y: box.y - 25,
          width: box.width + 30,
          height: box.height + 50,
        },
      });
      console.log(`📸 Đã chụp chính xác popup (${Math.round(box.width)}×${Math.round(box.height)})`);
    } else {
      console.warn("⚠️ Không lấy được boundingBox, dùng vùng mặc định.");
      await page.screenshot({
        path: screenshotPath,
        clip: { x: 1220, y: 180, width: 420, height: 780 },
      });
    }
  } else {
    console.warn("⚠️ Không tìm thấy popup, dùng vùng mặc định.");
    await page.screenshot({
      path: screenshotPath,
      clip: { x: 1220, y: 180, width: 420, height: 780 },
    });
  }
} catch (screenshotErr) {
  console.error("⚠️ Lỗi khi chụp popup:", screenshotErr.message);
}
    // ====== Upload ảnh lên Supabase Storage ======
    const imageFile = fs.readFileSync(screenshotPath);
    const { error: uploadError } = await supabase.storage
      .from("ship-images")
      .upload(`${ship.name.replace(/\s+/g, "_")}_map.png`, imageFile, {
        contentType: "image/png",
        upsert: true,
      });
    if (uploadError) throw new Error("Upload ảnh lỗi: " + uploadError.message);

    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/ship-images/${ship.name.replace(/\s+/g, "_")}_map.png`;
    
    // === Cập nhật bảng ships ===
    const { error: shipErr } = await supabase.from("ships").upsert([
      {
        id: ship.id,
        name: ship.name,
        latitude: lat,
        longitude: lon,
        speed,
        heading,
        status: "Active",
        updated_at: new Date().toISOString(),
      },
    ]);

    if (shipErr) console.error("❌ Lỗi cập nhật ships:", shipErr.message);
    else console.log("✅ Đã cập nhật dữ liệu tàu!");

  } catch (err) {
    console.error("⚠️ Lỗi:", err.message);
  } finally {
    await browser.close();
    console.log("🧭 Đóng trình duyệt\n");
  }
}

// === Vòng lặp chạy tất cả tàu ===
(async () => {
  for (const ship of ships) {
    await getShipData(ship);
    await delay(5000);
  }
})();













