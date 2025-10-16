// === track-puppeteer.js ===
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const USER_ORG_ID = process.env.USER_ORG_ID || "5073584d-1262-4f0b-b433-cf0520dd5352";
puppeteer.use(StealthPlugin());

// ==== SUPABASE CONFIG ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==== LOAD MULTIPLE SHIPS ====
const ships = JSON.parse(fs.readFileSync("./ships.json", "utf8"));

// ==== HELPER ====
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==== MAIN FUNCTION ====
async function getShipData(ship) {
  const browser = await puppeteer.launch({
     headless: true, // 🚀 chạy ẩn, không mở giao diện
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );

  try {
    const url = `https://www.marinetraffic.com/en/ais/home/shipid:${ship.ship_id}/zoom:10`;
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

    const pageText = await page.evaluate(() => document.body.innerText);

    // ====== Lấy hành trình ======
    const routeMatch = pageText.match(/VN\s+\w+\s+VN\s+\w+/);
    const atdMatch = pageText.match(/ATD:\s*([0-9\-:\s]+)/);
    const etaMatch = pageText.match(/ETA.*?:\s*([0-9\-:\s]+)/) || pageText.match(/Reported ETA:\s*([0-9\-:\s]+)/);

    const route = routeMatch ? routeMatch[0].replace(/\s+/g, " ").trim() : "Unknown Route";
    const atd = atdMatch ? new Date(atdMatch[1]) : null;
    const eta = etaMatch ? new Date(etaMatch[1]) : null;

    console.log(`🚢 Hành trình: ${route}`);
    console.log(`🕓 ATD: ${atd} | ETA: ${eta}`);

    // ====== Lấy toạ độ / tốc độ / hướng ======
    const coordMatch = pageText.match(/\(([-+]?\d+\.\d+),\s*([-+]?\d+\.\d+)\)/);
    const speedMatch = pageText.match(/(\d+(?:\.\d+)?)\s*kn/i);
    const headingMatch = pageText.match(/\/\s*(\d{1,3})°/);

    const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
    const lon = coordMatch ? parseFloat(coordMatch[2]) : null;
    const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;
    const heading = headingMatch ? parseFloat(headingMatch[1]) : 0;

    console.log(`📍 Toạ độ: ${lat}, ${lon}`);
    console.log(`⚡ Tốc độ: ${speed} kn | Hướng: ${heading}°`);

    // ====== Ghi hành trình vào trips (nếu mới) ======
    if (route !== "Unknown Route" && atd) {
      const { data: existingTrips } = await supabase
        .from("trips")
        .select("*")
        .eq("ship_id", ship.vessel_id)
        .eq("route", route)
        .eq("departure_date_time", atd.toISOString());

      if (!existingTrips || existingTrips.length === 0) {
      const safeATD = atd ? new Date(atd).toISOString() : null;
      const safeETA = eta ? new Date(eta).toISOString() : null;

      console.log("🧾 Dữ liệu gửi lên trips:", {
  user_id: USER_ORG_ID,
  organization_id: USER_ORG_ID,
  ship_id: ship.vessel_id,
  ship_name: ship.name,
  name: route || "Unnamed Route",
  route,
  departure_date_time: safeATD,
  eta: safeETA,
  created_at: new Date().toISOString(),
});

      const { error: tripError } = await supabase.from("trips").insert([
  {
    user_id: USER_ORG_ID,
    organization_id: USER_ORG_ID,
    ship_id: ship.vessel_id,
    ship_name: ship.name,
    name: route || "Unnamed Route",
    route,
    departure_date_time: safeATD,
    eta: safeETA,
    created_at: new Date().toISOString(),
  },
]);


        if (tripError) console.error("❌ Lỗi tạo hành trình:", tripError.message);
        else console.log("✅ Đã thêm hành trình mới:", route);
      } else {
        console.log("ℹ️ Hành trình đã tồn tại, bỏ qua ghi mới.");
      }
    }

    // ====== Chụp ảnh khu vực bản đồ ======
    const screenshotPath = `./${ship.name.replace(/\s+/g, "_")}_map.png`;
    const screenshotRegion = { x: 1150, y: 250, width: 750, height: 850 };
    await page.screenshot({ path: screenshotPath, clip: screenshotRegion });
    console.log("📸 Đã chụp ảnh khu vực bản đồ.");

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

    // ====== Cập nhật bảng ships ======
    const { error: shipError } = await supabase.from("ships").upsert([
      {
        id: ship.vessel_id,
        name: ship.name,
        latitude: lat,
        longitude: lon,
        speed,
        heading,
        image_url: imageUrl,
        status: "Active",
        updated_at: new Date().toISOString(),
      },
    ]);

    if (shipError) console.error("❌ Lỗi cập nhật ships:", shipError.message);
    else console.log(`✅ Cập nhật thành công dữ liệu tàu: ${ship.name}`);
  } catch (err) {
    console.error("⚠️ Lỗi:", err.message);
  } finally {
    await delay(5000);
    await browser.close();
  }
}

// === Chạy tuần tự từng tàu ===
(async () => {
  for (const ship of ships) {
    console.log(`\n🚀 Bắt đầu xử lý tàu: ${ship.name}`);
    await getShipData(ship);
  }
  console.log("\n🎯 Hoàn tất xử lý tất cả tàu!");
})();
