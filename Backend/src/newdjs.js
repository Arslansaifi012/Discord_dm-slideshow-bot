import 'dotenv/config';
import twemoji from 'twemoji';
import { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, Events, StringSelectMenuBuilder 
} from 'discord.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import AdmZip from 'adm-zip';

// ========== THEME CONFIGURATION ==========
const THEMES = {
    ios_dark: {
        name: "iOS Dark",
        right_bubble: '#007AFF',
        right_text: '#FFFFFF',
        left_bubble: '#26262b',
        left_text: '#FFFFFF',
        bg: '#000000',
        secondary: '#8E8E93'
    },
    ios_pink: { 
        name: "iOS Dark Pink", 
        right_bubble: "#C01F4A", 
        right_text: "#FFFFFF", 
        left_bubble: "#2A2A2E", 
        left_text: "#FFFFFF", 
        bg: "#000000", 
        secondary: "#8E8E93" 
    },
    ios_light: {
        name: "iOS Light",
        right_bubble: '#007AFF',
        right_text: '#FFFFFF',
        left_bubble: '#E9E9EB',
        left_text: '#000000',
        bg: '#FFFFFF',
        secondary: '#8E8E93'
    }
};

const DIRS = ['scripts', 'output', 'temp'];
DIRS.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

try {
    registerFont(path.join(process.cwd(), 'fonts/SF-Pro-Display-Semibold.otf'), { family: 'SF Pro Semibold' });
    registerFont(path.join(process.cwd(), 'fonts/SF-Pro-Display-Regular.otf'), { family: 'SF Pro' });
    console.log('✅ Premium fonts loaded');
} catch (err) {
    console.warn('⚠️ Premium fonts missing. Using fallback fonts.');
}

ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

const sessions = new Map();
const emojiCache = new Map();
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// ========== SCROLLBAR UTILITY ==========
function drawIOSScrollBar(ctx, currentIdx, totalIdx, theme) {
    const barWidth = 6;
    const barHeight = 250; 
    const rightPadding = 10;
    const topLimit = 700; 
    const bottomLimit = 1400; 
    const scrollRange = bottomLimit - topLimit;

    const progress = totalIdx > 1 ? currentIdx / (totalIdx - 1) : 0;
    const yPos = topLimit + (progress * scrollRange);

    ctx.save();
    ctx.fillStyle = theme.bg === '#FFFFFF' ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.roundRect(1080 - rightPadding - barWidth, yPos, barWidth, barHeight, 3);
    ctx.fill();
    ctx.restore();
}

// ========== IMAGE LOADING FIX ==========
async function safeLoadImage(url) {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('video')) {
            throw new Error('Attempted to load a video as an image.');
        }

        const buffer = await response.arrayBuffer();
        const img = await loadImage(Buffer.from(buffer));
        return img;
    } catch (error) {
        // Check if it's an AbortError and handle it
        if (error.name === 'AbortError') {
            console.error("Image fetch timed out for URL:", url);
        } else {
            console.error("Image Load Error:", error.message);
        }
        const canvas = createCanvas(100, 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 100, 100);
        return canvas;
    } finally {
        clearTimeout(timeout);
    }
}

// ========== RENDERING UTILITIES ==========
const isEmojiOnly = (text) => {
    const segments = Array.from(segmenter.segment(text.trim()));
    return segments.every(s => /\p{Extended_Pictographic}/u.test(s.segment)) && segments.length > 0;
};

const loadEmoji = async (emoji) => {
    if (emojiCache.has(emoji)) return emojiCache.get(emoji);
    try {
        const code = twemoji.convert.toCodePoint(emoji);
        const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;
        const img = await safeLoadImage(url);
        emojiCache.set(emoji, img);
        return img;
    } catch (error) {
        return null;
    }
};

async function renderIOSBubble(ctx, msg, y, theme, measureOnly = false) {
    const text = String(msg.text ?? "").trim();
    const bigEmoji = isEmojiOnly(text);
    const fontSize = bigEmoji ? 115 : 44;
    const padX = 36, padY = 26, maxWidth = 780, lineHeight = fontSize * 1.2;

    ctx.font = `${fontSize}px "SF Pro", Arial`;
    let lines = [];
    const words = text.split(" ");
    let curLine = "";

    for (const word of words) {
        let test = curLine + word + " ";
        let w = 0;
        const segs = Array.from(segmenter.segment(test));
        for(const s of segs) w += /\p{Extended_Pictographic}/u.test(s.segment) ? fontSize * 1.05 : ctx.measureText(s.segment).width;

        if (w > maxWidth - padX * 2 && curLine !== "") {
            lines.push(curLine.trim());
            curLine = word + " ";
        } else { curLine = test; }
    }
    lines.push(curLine.trim());

    let maxW = 0;
    for (const l of lines) {
        let w = 0;
        const segs = Array.from(segmenter.segment(l));
        for(const s of segs) w += /\p{Extended_Pictographic}/u.test(s.segment) ? fontSize * 1.05 : ctx.measureText(s.segment).width;
        if (w > maxW) maxW = w;
    }

    const bW = maxW + padX * 2;
    const bH = lines.length * lineHeight + padY * 2;
    if (measureOnly) return bH + 15;

    const x = msg.side === "right" ? 1080 - bW - 40 : 40;
    if (!bigEmoji) {
        ctx.fillStyle = msg.side === "right" ? theme.right_bubble : theme.left_bubble;
        ctx.beginPath();
        ctx.roundRect(x, y, bW, bH, 50);
        ctx.fill();
    }

    ctx.fillStyle = bigEmoji ? (theme.bg === '#FFFFFF' ? '#000' : '#fff') : (msg.side === "right" ? theme.right_text : theme.left_text);
    ctx.textBaseline = "middle";
    
    for (let i = 0; i < lines.length; i++) {
        let cursorX = x + padX;
        let lineY = y + padY + (i * lineHeight) + (lineHeight / 2);
        const segments = Array.from(segmenter.segment(lines[i]));

        for (const { segment } of segments) {
            if (/\p{Extended_Pictographic}/u.test(segment)) {
                const img = await loadEmoji(segment);
                if (img) {
                    ctx.drawImage(img, cursorX, lineY - fontSize / 2, fontSize * 1.1, fontSize * 1.1);
                    cursorX += (fontSize * 1.1) + 4;
                }
            } else {
                ctx.fillText(segment, cursorX, lineY);
                cursorX += ctx.measureText(segment).width;
            }
        }
    }
    return bH + 15;
}

// ========== PLUGAI WIDGET RENDERER (CENTERED) ==========
async function renderPlugAIChatWidget(ctx, y, plugData, theme) {
  const w = 1040; 
  const x = (1080 - w) / 2;
  
  const chatPaddingTop = 30; 
  const bubbleGap = 18;  
  const chatAreaMarginX = 60;
  const chatAreaX = x + chatAreaMarginX; 
  const chatAreaY = y + 160; 
  const chatAreaW = w - (chatAreaMarginX * 2);

  const measureBubble = (text) => {
    const maxWidth = 550; 
    ctx.font = '600 40px Arial';
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';
    for (let n = 0; n < words.length; n++) {
      let testLine = currentLine + words[n] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        lines.push(currentLine);
        currentLine = words[n] + ' ';
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    return (lines.length * 48) + 40;
  };

  const h1 = measureBubble(plugData?.messages?.[0]?.text || "");
  const h2 = measureBubble(plugData?.messages?.[1]?.text || "");
  const h3 = measureBubble(plugData?.messages?.[2]?.text || "");
  
  const chatAreaH = chatPaddingTop + h1 + bubbleGap + h2 + bubbleGap + h3 + 30;

  const blueBoxMarginX = 20;
  const notchWidth = 15;
  const blueBoxW = w - (blueBoxMarginX * 2) - notchWidth;
  const blueBoxX = x + blueBoxMarginX;
  const blueLineHeight = 60; 
  ctx.font = '700 52px Arial';
  
  const suggestion = plugData?.blueReply || '';
  const suggWords = suggestion.split(' ');
  let suggLines = [];
  let currentSuggLine = '';

  for (let i = 0; i < suggWords.length; i++) {
    const testLine = currentSuggLine + suggWords[i] + ' ';
    if (ctx.measureText(testLine).width > blueBoxW - 80) {
      suggLines.push(currentSuggLine.trim());
      currentSuggLine = suggWords[i] + ' ';
    } else {
      currentSuggLine = testLine;
    }
  }
  if (currentSuggLine) suggLines.push(currentSuggLine.trim());
  
  const bluePaddingY = 50;
  const blueBoxH = (suggLines.length * blueLineHeight) + (bluePaddingY * 1.5);

  const tapToCopySpace = 75; 
  const blueBoxY = chatAreaY + chatAreaH + tapToCopySpace + 60; 
  const containerPaddingBottom = 70;
  const totalHeight = (blueBoxY + blueBoxH + containerPaddingBottom) - y;

  ctx.save();
  
  ctx.fillStyle = '#B6D2FC'; 
  ctx.fillRect(0, y, 1080, totalHeight);

  const headerY = y + 80;
  ctx.font = '900 100px Arial';
  ctx.fillStyle = '#F84C5C';
  ctx.textAlign = 'left';
  ctx.fillText('‹', x + 10, headerY + 5);
  ctx.textAlign = 'right';
  ctx.fillText('+', x + w - 10, headerY + 5);
  
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 1000 110px Arial';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  
  ctx.strokeText('PlugAI', x + w / 2, headerY);
  ctx.fillText('PlugAI', x + w / 2, headerY);

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(chatAreaX, chatAreaY, chatAreaW, chatAreaH, 55);
  } else {
    const radius = 55;
    ctx.moveTo(chatAreaX + radius, chatAreaY);
    ctx.lineTo(chatAreaX + chatAreaW - radius, chatAreaY);
    ctx.quadraticCurveTo(chatAreaX + chatAreaW, chatAreaY, chatAreaX + chatAreaW, chatAreaY + radius);
    ctx.lineTo(chatAreaX + chatAreaW, chatAreaY + chatAreaH - radius);
    ctx.quadraticCurveTo(chatAreaX + chatAreaW, chatAreaY + chatAreaH, chatAreaX + chatAreaW - radius, chatAreaY + chatAreaH);
    ctx.lineTo(chatAreaX + radius, chatAreaY + chatAreaH);
    ctx.quadraticCurveTo(chatAreaX, chatAreaY + chatAreaH, chatAreaX, chatAreaY + chatAreaH - radius);
    ctx.lineTo(chatAreaX, chatAreaY + radius);
    ctx.quadraticCurveTo(chatAreaX, chatAreaY, chatAreaX + radius, chatAreaY);
    ctx.closePath();
  }
  ctx.fill();

  const drawBubble = (text, startY, isRight, bH) => {
    const maxWidth = 550;
    ctx.font = '600 40px Arial';
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';
    for (let n = 0; n < words.length; n++) {
      let testLine = currentLine + words[n] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        lines.push(currentLine);
        currentLine = words[n] + ' ';
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);

    const widestLine = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bW = widestLine + 70;
    const bX = isRight ? (chatAreaX + chatAreaW - bW - 25) : (chatAreaX + 25);

    ctx.fillStyle = isRight ? theme.right_bubble : theme.left_bubble;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(bX, startY, bW, bH, 40);
    } else {
      const radius = 40;
      ctx.moveTo(bX + radius, startY);
      ctx.lineTo(bX + bW - radius, startY);
      ctx.quadraticCurveTo(bX + bW, startY, bX + bW, startY + radius);
      ctx.lineTo(bX + bW, startY + bH - radius);
      ctx.quadraticCurveTo(bX + bW, startY + bH, bX + bW - radius, startY + bH);
      ctx.lineTo(bX + radius, startY + bH);
      ctx.quadraticCurveTo(bX, startY + bH, bX, startY + bH - radius);
      ctx.lineTo(bX, startY + radius);
      ctx.quadraticCurveTo(bX, startY, bX + radius, startY);
      ctx.closePath();
    }
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillText(line.trim(), bX + 35, startY + 45 + (i * 48));
    });
  };

  drawBubble(plugData?.messages?.[0]?.text, chatAreaY + chatPaddingTop, false, h1);
  drawBubble(plugData?.messages?.[1]?.text, chatAreaY + chatPaddingTop + h1 + bubbleGap, true, h2);
  drawBubble(plugData?.messages?.[2]?.text, chatAreaY + chatPaddingTop + h1 + bubbleGap + h2 + bubbleGap, false, h3);

  ctx.fillStyle = '#7C93AC';
  ctx.font = '600 38px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('tap to copy', x + w / 2, chatAreaY + chatAreaH + tapToCopySpace);

  ctx.fillStyle = '#007AFF';
  const radius = 55;
  const bBX = blueBoxX;
  const bBY = blueBoxY;
  const bBW = blueBoxW;
  const bBH = blueBoxH;

  ctx.beginPath();
  ctx.moveTo(bBX + radius, bBY);
  ctx.lineTo(bBX + bBW - radius, bBY);
  ctx.quadraticCurveTo(bBX + bBW, bBY, bBX + bBW, bBY + radius);
  ctx.lineTo(bBX + bBW, bBY + bBH - 20);
  ctx.lineTo(bBX + bBW + 12, bBY + bBH);
  ctx.lineTo(bBX + bBW - 20, bBY + bBH - 5);
  ctx.quadraticCurveTo(bBX + bBW - radius, bBY + bBH, bBX + bBW - radius, bBY + bBH);
  ctx.lineTo(bBX + radius, bBY + bBH);
  ctx.quadraticCurveTo(bBX, bBY + bBH, bBX, bBY + bBH - radius);
  ctx.lineTo(bBX, bBY + radius);
  ctx.quadraticCurveTo(bBX, bBY, bBX + radius, bBY);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.font = '700 52px Arial';
  
  const textHeight = suggLines.length * blueLineHeight;
  let textY = blueBoxY + (blueBoxH - textHeight) / 2 + blueLineHeight * 0.8;  

  suggLines.forEach(l => {
    ctx.fillText(l, blueBoxX + 45, textY);
    textY += blueLineHeight;
  });
  
  ctx.restore();
  return totalHeight;
}

// ========== VIDEO ENGINE ==========
async function generateVideo(data, message) {
    const userId = message.author.id;
    const theme = THEMES[data.theme || 'ios_dark'];
    const userTemp = path.join('temp', userId);
    if (!fs.existsSync(userTemp)) fs.mkdirSync(userTemp, { recursive: true });

    try {
        const script = fs.readFileSync(data.txtPath, "utf8");
        const lines = script.split("\n").filter(l => l.trim());
        const parsed = [];
        const specialElements = [];

        lines.forEach(l => {
            const m = l.match(/([^\s<>]+\.(png|jpg|jpeg|gif|webp))\s*<([\d.]+)s>/i);
            if (l.trim() === '[PLUG_WIDGET]') {
                specialElements.push({ after: parsed.length - 1, type: 'plug' });
            } else if (m) {
                specialElements.push({ after: parsed.length - 1, type: 'image', file: m[1] });
            } else {
                parsed.push({ side: l.startsWith("R") ? "right" : "left", text: l.replace(/^(R\)|L\))\s*/, "") });
            }
        });

        if (parsed.length === 0) throw new Error("No valid messages.");

        let fIdx = 0;
        const FPS = 30; 
        const messageDuration = data.duration || 1.3; 
        const holdFrames = Math.floor(messageDuration * FPS);

        const saveFrame = (canvas) => {
            const fPath = path.join(userTemp, `frame_${String(fIdx).padStart(6, '0')}.png`);
            fs.writeFileSync(fPath, canvas.toBuffer());
            fIdx++;
        };

        const renderState = async (opacity = 1.0, currentIdx, isWidget = false) => {
            const c = createCanvas(1080, 1920);
            const cx = c.getContext("2d");
            cx.fillStyle = theme.bg;
            cx.fillRect(0, 0, 1080, 1920);

            if (isWidget) {
                const widgetMsgs = parsed.slice(Math.max(0, currentIdx - 2), currentIdx + 1);
                const blueReply = parsed[currentIdx + 1]?.text;
                await renderPlugAIChatWidget(cx, 400, { messages: widgetMsgs, blueReply }, theme);
            } else if (currentIdx === 0) {
                drawIOSScrollBar(cx, currentIdx, parsed.length, theme);
                if (data.storyImage) {
                    const sImg = await safeLoadImage(data.storyImage);
                    cx.save();
                    cx.roundRect(610, 650, 420, 560, 35);
                    cx.clip();
                    cx.drawImage(sImg, 610, 650, 420, 560);
                    cx.restore();
                }
                cx.fillStyle = theme.secondary;
                cx.font = '34px "SF Pro Semibold", Arial';
                cx.fillText("Sent a reply to your story", 610, 610);
                await renderIOSBubble(cx, { text: parsed[0].text, side: "right" }, 1240, theme);
            } else {
                cx.globalAlpha = opacity;
                const visible = parsed.slice(Math.max(0, currentIdx - data.repeat), currentIdx + 1);
                let h = 0;
                for (const m of visible) h += await renderIOSBubble(cx, m, 0, theme, true);
                let curY = (1920 - h) / 2;
                for (const m of visible) curY += await renderIOSBubble(cx, m, curY, theme, false);
                cx.globalAlpha = 1.0;
            }
            return c;
        };

        for (let i = 0; i < parsed.length; i++) {
            const canvasHold = await renderState(1.0, i);
            for (let h = 0; h < holdFrames; h++) saveFrame(canvasHold);

            const trigger = specialElements.find(el => el.after === i);
            if (trigger) {
                if (trigger.type === 'plug') {
                    const widgetCanvas = await renderState(1.0, i, true);
                    for (let h = 0; h < holdFrames * 2; h++) saveFrame(widgetCanvas);
                } else if (trigger.type === 'image' && data.uploadedImages[trigger.file]) {
                    const ic = createCanvas(1080, 1920);
                    const icx = ic.getContext("2d");
                    icx.fillStyle = "#000";
                    const upImg = await safeLoadImage(data.uploadedImages[trigger.file].url);
                    const sc = Math.min(1080 / upImg.width, 1920 / upImg.height);
                    icx.drawImage(upImg, (1080 - upImg.width * sc) / 2, (1920 - upImg.height * sc) / 2, upImg.width * sc, upImg.height * sc);
                    for (let h = 0; h < holdFrames; h++) saveFrame(ic);
                }
            }
        }

        const timestamp = Date.now();
        const output = path.join('output', `${userId}_${timestamp}.mp4`);
        const zipPath = path.join('output', `${userId}_${timestamp}_frames.zip`);

        // Create ZIP of frames
        const zip = new AdmZip();
        zip.addLocalFolder(userTemp);
        zip.writeZip(zipPath);

        // GPU-ACCELERATED VIDEO ENCODING
        console.log('🎬 Starting GPU-accelerated video encoding...');
        
        await new Promise((resolve, reject) => {
            const ffmpegCmd = ffmpeg()
                .input(path.join(userTemp, 'frame_%06d.png'))
                .inputFPS(FPS)
                .output(output);
            
            // GPU ENCODING SETTINGS BASED ON PLATFORM
            if (process.platform === 'win32' || process.platform === 'linux') {
                console.log('🟢 Using NVIDIA GPU encoding (h264_nvenc)...');
                ffmpegCmd
                    .videoCodec('h264_nvenc')
                    .outputOptions([
                       '-preset p2',
                        '-rc vbr',
                        '-cq 28',
                         '-pix_fmt yuv420p',
                          '-profile:v high',
                    ]);
            } 
            else if (process.platform === 'darwin') {
                console.log('🍎 Using Apple GPU encoding (h264_videotoolbox)...');
                ffmpegCmd
                    .videoCodec('h264_videotoolbox')
                    .outputOptions([
                        '-q:v 70',
                        '-pix_fmt yuv420p',
                        '-profile:v high',
                        '-level 4.2'
                    ]);
            }
            else {
                console.log('⚡ Using CPU encoding (libx264)...');
                ffmpegCmd
                    .videoCodec('libx264')
                    .outputOptions([
                        '-preset fast',
                        '-crf 18',
                        '-pix_fmt yuv420p'
                    ]);
            }
            
            ffmpegCmd
                .on('start', (cmd) => {
                    console.log('🚀 FFmpeg command:', cmd);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`📊 Encoding: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    console.log('✅ Video encoding completed!');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ GPU encoding failed, trying CPU fallback...', err.message);
                    
                    // FALLBACK TO CPU ENCODING
                    ffmpeg()
                        .input(path.join(userTemp, 'frame_%06d.png'))
                        .inputFPS(FPS)
                        .videoCodec('libx264')
                        .outputOptions([
                            '-preset fast',
                            '-crf 18',
                            '-pix_fmt yuv420p'
                        ])
                        .output(output)
                        .on('end', () => {
                            console.log('✅ CPU fallback encoding completed!');
                            resolve();
                        })
                        .on('error', (fallbackErr) => {
                            console.error('❌ CPU encoding also failed:', fallbackErr.message);
                            reject(fallbackErr);
                        })
                        .run();
                })
                .run();
        });

        // Send results to user - FIXED SECTION
        const encodingMethod = process.platform === 'win32' || process.platform === 'linux' ? 
            'NVIDIA GPU' : process.platform === 'darwin' ? 'Apple GPU' : 'CPU';
        
        console.log("Video size (MB):", (fs.statSync(output).size / (1024*1024)).toFixed(2));

        // ADD THIS: Send files separately with delay
       try {
    await message.author.send({
        content: `✅ **Video Generated!**\n\n• **Video:** \`${path.basename(output)}\`\n• **Encoding:** ${encodingMethod}-accelerated\n• **Size:** ${(fs.statSync(output).size / (1024*1024)).toFixed(2)}MB`,
        files: [{ attachment: fs.createReadStream(output), name: path.basename(output) }]
    });
    console.log("✅ Video DM sent");
} catch (err) {
    console.error("❌ Video DM failed:", err);
    throw err; // video fail = real failure
}

// 2️⃣ SEND ZIP (OPTIONAL)
try {
    await new Promise(r => setTimeout(r, 1000));

    await message.author.send({
        content: `📦 **Frames Archive:** \`${path.basename(zipPath)}\``,
        files: [{ attachment: fs.createReadStream(zipPath), name: path.basename(zipPath) }]
    });
    console.log("✅ ZIP DM sent");
} catch (zipErr) {
    console.warn("⚠️ ZIP send failed (ignoring):", zipErr.message);
    // ZIP failure should NOT trigger fallback
}
    } finally {
        // Cleanup - ADD SAFETY CHECK
        try {
            // Wait a moment before cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (fs.existsSync(userTemp)) {
                fs.rmSync(userTemp, { recursive: true, force: true });
                console.log(`🧹 Cleaned temp directory for user ${userId}`);
            }
            if (data.txtPath && fs.existsSync(data.txtPath)) {
                fs.unlinkSync(data.txtPath);
                console.log(`🧹 Cleaned script file: ${data.txtPath}`);
            }
        } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr);
        }
        
        sessions.delete(userId);
    }
}

// ========== BOT EVENTS ==========
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || msg.channel.type !== 1) return;
    let session = sessions.get(msg.author.id);

    if (!session) {
        if (msg.mentions.has(client.user)) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("start_gen")
                    .setLabel("🚀 Start iOS DM Maker")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📱")
            );
            return msg.reply({ 
                content: "**📱 iOS DM Maker**\n\nCreate stunning iOS-style conversation videos!", 
                components: [row] 
            });
        }
        return;
    }

    try {
        switch (session.step) {
            case "UPLOAD_TXT":
                const file = msg.attachments.first();
                if (!file?.name.endsWith('.txt')) return msg.reply("❌ Upload a .txt file.");
                const txtPath = path.join('scripts', `${msg.author.id}_${Date.now()}.txt`);
                const res = await fetch(file.url);
                fs.writeFileSync(txtPath, Buffer.from(await res.arrayBuffer()));
                session.data.txtPath = txtPath;
                session.step = "STORY";
                msg.reply("📸 **Step 2:** Send the Story Image.");
                break;
            case "STORY":
                const sImg = msg.attachments.first();
                if (!sImg || !sImg.contentType?.startsWith('image/')) return msg.reply("❌ Please upload an IMAGE file.");
                session.data.storyImage = sImg.url;
                session.step = "REPEAT";
                msg.reply("🔢 **Step 3:** Previous messages count?");
                break;
            case "REPEAT":
                session.data.repeat = parseInt(msg.content) || 2;
                session.step = "DURATION";
                msg.reply("⏱ **Step 4:** Seconds per message?");
                break;
            case "DURATION":
                session.data.duration = parseFloat(msg.content) || 1.3;
                session.step = "FADE";
                msg.reply("🌑 **Step 5:** Fade?");
                break;
            case "FADE":
                session.data.fade = parseFloat(msg.content) || 0;
                const script = fs.readFileSync(session.data.txtPath, 'utf8');
                const req = [...new Set([...script.matchAll(/([^\s<>]+\.(png|jpg|jpeg|gif|webp))/gi)].map(m => m[1]))];
                session.data.required = req;
                if (req.length > 0) {
                    session.step = "MEDIA";
                    msg.reply(`🖼 **Step 6:** Send image for: **${req[0]}**`);
                } else {
                    msg.reply("🚀 Processing with GPU acceleration...");
                    await generateVideo(session.data, msg);
                }
                break;
            case "MEDIA":
                const up = msg.attachments.first();
                if (!up || !up.contentType?.startsWith('image/')) return msg.reply("❌ Upload an IMAGE.");
                const idx = Object.keys(session.data.uploadedImages).length;
                session.data.uploadedImages[session.data.required[idx]] = { url: up.url };
                if (Object.keys(session.data.uploadedImages).length < session.data.required.length) {
                    msg.reply(`✅ Next: **${session.data.required[idx + 1]}**`);
                } else {
                    msg.reply("🚀 Generating with GPU acceleration...");
                    await generateVideo(session.data, msg);
                }
                break;
        }
    } catch (e) { 
        console.error("Session error:", e);
        sessions.delete(msg.author.id); 
    }
});

client.on(Events.InteractionCreate, async (i) => {
    if (i.isButton() && i.customId === "start_gen") {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('select_theme')
            .setPlaceholder('Theme')
            .addOptions(
                { label: 'iOS Dark', value: 'ios_dark', emoji: '🌙' },
                { label: 'iOS Light', value: 'ios_light', emoji: '☀️' },
                { label: 'iOS pink', value: 'ios_pink', emoji: '🍓' }
            );
        await i.reply({ 
            content: "🎨 **Select Theme**\n\nChoose a theme for your iOS conversation video:", 
            components: [new ActionRowBuilder().addComponents(menu)], 
            flags: 64 
        });
    }
    if (i.isStringSelectMenu() && i.customId === 'select_theme') {
        sessions.set(i.user.id, { 
            step: "UPLOAD_TXT", 
            data: { 
                theme: i.values[0], 
                uploadedImages: {}, 
                repeat: 2, 
                duration: 1.5, 
                fade: 0.3 
            }, 
            expires: Date.now() + 600000 
        });
        await i.update({ 
            content: `✅ Theme set to: ${THEMES[i.values[0]].name}\n\n📄 **Step 1:** Upload your .txt script file.`, 
            components: [], 
            flags: 64 
        });
    }
});

client.once(Events.ClientReady, () => {
    console.log(`✅ Bot ready: ${client.user.tag}`);
    console.log('⚡ GPU-accelerated video encoding enabled');
});

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN).catch(console.error);