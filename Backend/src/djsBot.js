import 'dotenv/config';
import twemoji from 'twemoji';
import { Client, GatewayIntentBits, Partials,ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } from 'discord.js';
import { createCanvas, loadImage } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';


ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const sessions = new Map();
const PREFIX = "@";

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.mentions.has(client.user)) {
    await message.reply("Hey lets generate you DM screenshots ");
  }
  if (message.channel.type !== 1) return;

  const content = message.content;
  const session = sessions.get(message.author.id);

  // Start Command
  if (content === `${PREFIX}dms`) {
    sessions.set(message.author.id, { step: "WAIT_BUTTON", data: {} });
    const button = new ButtonBuilder().setCustomId("start_dms")
    .setLabel("Start DM Generater") 
    .setStyle(ButtonStyle.Primary)  ;
    const row = new ActionRowBuilder().addComponents(button) ;
    return message.reply({
      content:"Hey, let's generate your DM screenshots.\n👇 Click the button to continue" ,
       components:[row]
    });
  }
  if (!session) return;
  switch (session.step) {
    // STEP 0 — TXT
    case 0: {
      const file = message.attachments.first();
      if (!file || !file.name.endsWith(".txt"))
        return message.reply("Upload a valid .txt file");

      const dir = path.join(process.cwd(), "scripts");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);

      const txtPath = path.join(dir, `${message.author.id}.txt`);
      const res = await fetch(file.url);
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(txtPath, buffer);

      session.data.txtPath = txtPath;
      session.step = "story";
      return message.reply("📸 Now send the story image");
    }

    // STORY IMAGE
    case "story": {
      const img = message.attachments.first();
      if (!img) return message.reply("Attach one image");

      session.data.storyImage = img.url;
      session.step = 1;
      return message.reply("How many previous messages should repeat?");
    }

    // SETTINGS
    case 1:
    case 2:
    case 3:
    case 4: {
      const num = Number(content);
      if (isNaN(num)) return message.reply("Enter a number");

      if (session.step === 1) {
        session.data.repeat = num;
        session.step = 2;
        return message.reply("Messages per image?");
      }
      if (session.step === 2) {
        session.data.perImage = num;
        session.step = 3;
        return message.reply("Image duration (seconds)?");
      }
      if (session.step === 3) {
        session.data.duration = num;
        session.step = 4;
        return message.reply("Fade duration (seconds)?");
      }
      // if (session.step === 4) {
      //   session.data.fade = num;
      //   await message.reply("🎬 Generating video...");
      //   await generateVideo(session.data, message);
      //   sessions.delete(message.author.id);
      // }
      if (session.step === 4) {
        session.data.fade = num ;
        session.data.requiredImages = extractImageNames(session.data.txtPath) ;
        
        if (
       !session.data.requiredImages ||
       session.data.requiredImages.length === 0
    ) {
  await message.reply(
    " No image instructions found in TXT.\n" +
    "Use format: image.png <2s>"
  );

  sessions.delete(message.author.id);
  return;
}
        session.data.uploadedImages = {} ;
        session.step = "image_upload" ;
        const first = session.data.requiredImages[0] ;
        return  message.reply(`Now send the file for **${first.name}**`) ;
      }
    }

    case "image_upload":{
      const img = message.attachments.first() ;
      if (!img) {
        return message.reply("Attach the image file")
      }

      const index = Object.keys(session.data.uploadedImages).length ;
      const current = session.data.requiredImages[index] ;

      if (!current) {
        return message.reply("NO More images Required") ;
      }

      session.data.uploadedImages[current.name] = {
        url:img.url,
        duration:current.duration
      } ;

      const nextIndex = index+1 ;
      const next = session.data.requiredImages[nextIndex] ;

      if (next) {
        return message.reply(
          `Received file for **${current.name}**.\nNow send the file for **${next.name}**`
        )} ;

        await message.reply("Generating video...") ;
        await generateVideo(session.data, message) ;
        sessions.delete(message.author.id) ;
        break ;
    }
  }
});

client.on(Events.InteractionCreate, async(interaction)=>{
  if (!interaction.isButton()) return;
  if (interaction.customId !== "start_dms") return;
  const session = sessions.get(interaction.user.id);
  if (!session || session.step !== "WAIT_BUTTON") {
      return interaction.reply({
      content: "❌ Session not found or already started",
      ephemeral: true
    });
  }
  session.step = 0;

  await interaction.reply({
    content: "✅ Now upload your `.txt` file",
    ephemeral: true
  })
})

client.login(process.env.DISCORD_BOT_TOKEN);

function extractImageNames(txtPath) {
  const text = fs.readFileSync(txtPath, "utf-8");
  const lines = text.split(/\r?\n/);

  const images = [];

  for (let rawLine of lines) {
    const line = rawLine.trim(); // ⭐ MOST IMPORTANT

    if (!line) continue;
    if (line.startsWith("<")) continue;

    const match = line.match(
      /([^\s<>]+\.(png|jpg|jpeg))\s*<([\d.]+)s>/i
    );

    if (match) {
      images.push({
        name: match[1],
        duration: Number(match[3])
      });
    }
  }

  return images;
}


async function sendFramesFirst(message, frameDir) {
  const files  = fs
  .readdirSync(frameDir)
  .filter(f => f.endsWith(".png"))
  .sort((a,b) =>{
     const na = Number(a.match(/\d+/)?.[0] || 0);
      const nb = Number(b.match(/\d+/)?.[0] || 0);
      return na - nb;
  }) ;

  const MAX_FILES = 5 ;
  for(let i = 0; i<files.length; i += MAX_FILES){
    const batch = files.slice(i,i + MAX_FILES)
    .map(f => path.join(frameDir, f)) ;

    await message.author.send({
      files:batch
    })
  }
}


// ================= VIDEO =================
async function generateVideo(data, message) {

  const text = fs.readFileSync(data.txtPath, "utf8");
  const lines = text.split("\n").filter(Boolean);

  if (!fs.existsSync("frames")) fs.mkdirSync("frames");

  const parsed = [];
  const images = [];

  lines.forEach(raw => {
    let line = raw.trim();
    if (!line) return;
    const img = line.match(/(.+\.(png|jpg|jpeg))\s*<([\d.]+)s>/i);
    if (img) {
      images.push({
        after: parsed.length - 1,
        file: img[1],
        duration: Number(img[3])
      });
      return;
    }

    let side = line.startsWith("R") ? "right" : "left" ;
    parsed.push({
      side,
      text: line.replace(/^(R\)|L\))\s*/, "")
    });
  });

  // function roundRect(ctx, x, y, w, h, r) {
  //   ctx.beginPath();
  //   ctx.moveTo(x + r, y);
  //   ctx.lineTo(x + w - r, y);
  //   ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  //   ctx.lineTo(x + w, y + h - r);
  //   ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  //   ctx.lineTo(x + r, y + h);
  //   ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  //   ctx.lineTo(x, y + r);
  //   ctx.quadraticCurveTo(x, y, x + r, y);
  //   ctx.closePath();
  //   ctx.fill();
  // } ;


  // ========> emoji Handeler Function =======>

    
// const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// async function drawTextWithEmoji(ctx, text, x, y) {
//   ctx.font = "40px Arial";
//   ctx.fillStyle = "#fff";

//   let cursorX = x;
//   const segments = segmenter.segment(text);

//   for (const { segment } of segments) {
//     if (/\p{Extended_Pictographic}/u.test(segment)) {
//       const code = twemoji.convert.toCodePoint(segment);
//       const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;

//       const img = await loadImage(url);
//       ctx.drawImage(img, cursorX, y - 34, 36, 36);
//       cursorX += 40;
//     } else {
//       ctx.fillText(segment, cursorX, y);
//       cursorX += ctx.measureText(segment).width;
//     }
//   }
// }

// ============= Chat Bubble =====================

 function bubble(ctx, msg, y, measureOnly = false) {
  ctx.font = '40px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';
  const pad = 28;
  const maxBubbleWidth = 720;
  const lineHeight = 40;
  // const radius = 45;
  const bottomGap = 6;
  const tailHeight = 12;
  // ===== TEXT CLEAN + WRAP =====
  const cleanText = String(msg.text ?? "")
    .trim().replace(/[<>]/g, "");
  const words = cleanText.split(" ");
  let lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + " ";
    if (
      ctx.measureText(testLine).width > maxBubbleWidth - pad * 2 &&
      line !== ""
    ) {
      lines.push(line);
      line = words[i] + " ";
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  // ===== SIZE =====
  const textWidth = Math.max(
    ...lines.map(l => ctx.measureText(l).width)
  );
  const bubbleWidth = Math.min(
    maxBubbleWidth,
    textWidth + pad * 2
  );
  const bubbleHeight = lines.length * lineHeight + pad * 2;
  // ===== MEASURE ONLY =====
  if (measureOnly) {
    return bubbleHeight + tailHeight + bottomGap;
  }
  // ===== X POSITION =====
  const x = msg.side === "right"
    ? 1080 - bubbleWidth - 80
    : 80;
  // ===== BUBBLE BODY =====
  ctx.fillStyle = msg.side === "right" ? "#7a3cff" : "#2b2b2b";
  ctx.beginPath();
  ctx.roundRect(x, y, bubbleWidth, bubbleHeight,  [45, 45, 20, 45]);
  ctx.fill();

  // ===== TEXT =====
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";

  lines.forEach((l, i) => {
    ctx.fillText(l, x + pad, y + pad + i * lineHeight);

//     drawTextWithEmoji(
//   ctx,
//   l,
//   x + pad,
//   y + pad + i * lineHeight,
//   { font: ctx.font }
// );
  });
  return bubbleHeight + tailHeight + bottomGap;
}


// async function bubble(ctx, msg, y, measureOnly = false) {
//   ctx.font = '40px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",Arial';

//   const pad = 28;
//   const maxBubbleWidth = 720;
//   const lineHeight = 42;
//   const bottomGap = 6;
//   const tailHeight = 12;

//   const cleanText = String(msg.text ?? "").trim().replace(/[<>]/g, "");
//   const words = cleanText.split(" ");

//   let lines = [];
//   let line = "";

//   for (const w of words) {
//     const test = line + w + " ";
//     if (
//       ctx.measureText(test).width > maxBubbleWidth - pad * 2 &&
//       line
//     ) {
//       lines.push(line);
//       line = w + " ";
//     } else {
//       line = test;
//     }
//   }
//   if (line) lines.push(line);

//   const textWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
//   const bubbleWidth = Math.min(maxBubbleWidth, textWidth + pad * 2);
//   const bubbleHeight = lines.length * lineHeight + pad * 2;

//   if (measureOnly) {
//     return bubbleHeight + tailHeight + bottomGap;
//   }

//   const x = msg.side === "right"
//     ? 1080 - bubbleWidth - 80
//     : 80;

//   ctx.fillStyle = msg.side === "right" ? "#7a3cff" : "#2b2b2b";
//   ctx.beginPath();
//   ctx.roundRect(x, y, bubbleWidth, bubbleHeight, [45, 45, 20, 45]);
//   ctx.fill();

//   ctx.fillStyle = "#fff";

//   for (let i = 0; i < lines.length; i++) {
//     await drawTextWithEmoji(
//       ctx,
//       lines[i],
//       x + pad,
//       y + pad + i * lineHeight,
//       { font: ctx.font }
//     );
//   }

//   return bubbleHeight + tailHeight + bottomGap;
// }



function drawScrollBar(ctx, imgY, imgH, progress = 0) {

  const extra = 16;
  const y = imgY - extra / 2;
  const h = imgH + extra;

  const x = 1060;
  const w = 3;
  const r = 2;

  const p = Math.min(Math.max(progress, 0), 1);

  // 🔥 THIS was the real issue
  const thumbH = Math.max(50, h * 0.22);
  const thumbY = y + (h - thumbH) * p;

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.roundRect(x, thumbY, w, thumbH, r);
  ctx.fill();
}

  // FRAME 0 — STORY
  {
    const c = createCanvas(1080, 1920);
    const ctx = c.getContext("2d");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1080, 1920);

    const img = await loadImage(data.storyImage);
    const imgW = 400;
    const imgH = 450;
    const imgY = (1920 - imgH) / 2;
    const imgx = 1080 - imgW - 40 ;
    const radius = 32 ;

    
    ctx.fillStyle = "#aaa";
    ctx.font = "32px Arial";
    ctx.fillText("You replied to their story", imgx, imgY - 36);

    ctx.save() ;
    ctx.beginPath() ;
    ctx.roundRect(imgx, imgY, imgW, imgH, radius) ;
    ctx.clip() ;
    ctx.drawImage(img, imgx, imgY, imgW, imgH);
    ctx.restore() ;

    const bubbleY = imgY + imgH + 60 ;
    bubble(ctx, { text: parsed[0].text, side: "right" }, bubbleY);
    drawScrollBar(ctx, imgY, imgH, 0.1);

    fs.writeFileSync("frames/frame_0.png", c.toBuffer());
  }
  // CHAT FRAMES
  let f = 1;
  for (let i = 1; i < parsed.length; i++) {
    const c = createCanvas(1080, 1920);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1080, 1920);
    const visible = parsed.slice(Math.max(0, i - data.repeat), i + 1);

const SCREEN_HEIGHT = 1920;
const TOP_SAFE = 80;

// PASS 1 — total height calculate
let totalHeight = 0;
visible.forEach(m => {
  totalHeight += bubble(ctx, m, 0, true);
});
// scroll bar ========
drawScrollBar(ctx, i / parsed.length);

// center starting Y
let startY = (SCREEN_HEIGHT - totalHeight) / 2;

// safety clamp (never go too high)
startY = Math.max(startY, TOP_SAFE);

// PASS 2 — assign positions
let y = startY;
const slots = [];

visible.forEach(m => {
  slots.push(y);
  y += bubble(ctx, m, 0, true);
});

// PASS 3 — draw
visible.forEach((m, i) => {
  bubble(ctx, m, slots[i], false);
});
    fs.writeFileSync(`frames/frame_${f++}.png`, c.toBuffer()) ;

    const img =  images.find(im => im.after === i) ;
    if (img) {
      const c2 = createCanvas(1080,1920) ;
      const ctx2 = c2.getContext("2d") ;
      ctx2.fillStyle = "#000" ;
      ctx2.fillRect(0, 0, 1080, 1920);

      const image = await loadImage(data.uploadedImages[img.file].url); 

      const scale = Math.min(
  1080 / image.width,
  1920 / image.height
);
   const w = image.width * scale;
   const h = image.height * scale;
   const x = (1080 - w) / 2;
   const y = (1920 - h) / 2;

//  FINAL DRAW (important line)
ctx2.drawImage(image, x, y, w, h);   

         fs.writeFileSync(`frames/frame_${f++}.png`, c2.toBuffer());
    }
   
  }
  if (!fs.existsSync("output")) fs.mkdirSync("output");
  const out = `output/${message.author.id}.mp4`;

  await new Promise((res, rej) => {
    ffmpeg()
      .input("frames/frame_%d.png")
      .inputFPS(1 / data.duration)
      .outputOptions(["-pix_fmt yuv420p", "-vf scale=1080:1920"])
      .save(out)
      .on("end", res)
      .on("error", rej);
  });
  async function sendVideoLast(message, videPath) {
    await message.author.send({
    content: "✅ Your video is ready",
    files: [videPath]
  });
  }
  await sendFramesFirst(message, "frames");
  await sendVideoLast(message, out) ;

  // === cleanup ====
  fs.rmSync("frames", { recursive: true, force: true });
  fs.unlinkSync(data.txtPath);
}
