import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

async function searchMarktplaats(query) {
  const url = `https://www.marktplaats.nl/lrp/api/search?query=${encodeURIComponent(query)}&limit=30&offset=0`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.itemIdList || []).map(id => {
      const item = data.listings?.find(l => l.itemId === id);
      if (!item) return null;
      return {
        externalId: String(item.itemId),
        title: item.title,
        price: (item.priceInfo?.priceCents || 0) / 100,
        url: `https://www.marktplaats.nl${item.vipUrl || ''}`
      };
    }).filter(Boolean);
  } catch (err) {
    console.error('Scrape Fout:', err);
    return [];
  }
}

async function run() {
  console.log("--- Start Scrape Ronde ---");
  const { data: radars } = await supabase.from('radars').select('*').eq('is_active', true);
  const { data: profiles } = await supabase.from('profiles').select('telegram_chat_id').limit(1);
  const chatId = profiles?.[0]?.telegram_chat_id;

  if (!radars || radars.length === 0) {
    console.log("Geen actieve radars gevonden.");
    return;
  }

  for (const radar of radars) {
    const items = await searchMarktplaats(radar.query);

    for (const item of items) {
      if (item.price < radar.min_price || item.price > radar.max_price) continue;
      
      const hasNegative = (radar.negative_words || []).some(w => 
        item.title.toLowerCase().includes(w.toLowerCase())
      );
      if (hasNegative) continue;

      const { error } = await supabase.from('matches').insert([{
        radar_id: radar.id,
        external_id: item.externalId,
        title: item.title,
        price: item.price,
        url: item.url
      }]);

      if (!error) {
        console.log(`🎯 NIEUWE MATCH: ${item.title}`);
        if (chatId) {
          const msg = `🚨 *Koopmaat Deal Gevonden!*\n\n` +
                      `📌 *Radar:* ${radar.title}\n` +
                      `🏷 *Titel:* ${item.title}\n` +
                      `💰 *Prijs:* €${item.price.toFixed(2)}\n\n` +
                      `🔗 [Open Advertentie](${item.url})`;
          
          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' }).catch(() => {});
        }
      }
    }
  }
}

run();