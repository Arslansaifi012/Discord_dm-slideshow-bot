
import 'dotenv/config';
import AdmZip from 'adm-zip';
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
import path, { parse } from 'path';
import { Buffer } from 'buffer';
import { CLIENT_RENEG_LIMIT } from 'tls';

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

// ========== UTILITIES ==========

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

async function safeLoadImage(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            return await loadImage(Buffer.from(buffer));
        } catch (error) {
            if (i === retries - 1) {
                const canvas = createCanvas(100, 100);
                return canvas;
            }
            await new Promise(res => setTimeout(res, 1500));
        } finally {
            clearTimeout(timeout);
        }
    }
}

const isEmojiOnly = (text) => {
    const segments = Array.from(segmenter.segment(text.trim()));
    return segments.every(s => /\p{Extended_Pictographic}/u.test(s.segment)) && segments.length > 0;
};

const loadEmoji = async (emoji) => {
    if (emojiCache.has(emoji)) return emojiCache.get(emoji);
    try {
        const code = twemoji.convert.toCodePoint(emoji);
        const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${code}.png`;
        const img = await safeLoadImage(url);
        emojiCache.set(emoji, img);
        return img;
    } catch (error) { return null; }
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

// ========== OPTIMIZED VIDEO ENGINE ==========

async function generateVideo(data, message) {
    const userId = message.author.id;
    const theme = THEMES[data.theme || 'ios_dark'];
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    try {
        const script = fs.readFileSync(data.txtPath, "utf8");
        const lines = script.split("\n").filter(l => l.trim());
        const parsed = [];
        const inlineImages = [];

        lines.forEach(l => {
            // console.log(l,'check (l) line 209====>');
            
            const m = l.match(/([^\s<>]+\.(png|jpg|jpeg|gif|webp))\s*<([\d.]+)s>/i);
            // console.log(m,'check (m) line no:212)=====>');
            if (m) inlineImages.push({ after: parsed.length - 1, file: m[1] });
        
            else parsed.push({ side: l.startsWith("R") ? "right" : "left", text: l.replace(/^(R\)|L\))\s*/, "") });
            // console.log(inlineImages,'check inlineimages 213');
            // console.log(parsed,'check parsed 216');
            
            
        });

        if (parsed.length === 0) throw new Error("No valid messages.");

        const FPS = 30;
        const messageDuration = data.duration || 1.3;
        const holdFrames = Math.floor(messageDuration * FPS);
        const fadeFramesCount = 8;
        const outputFilePath = path.join(outputDir, `${userId}_${Date.now()}.mp4`);

        const zip = new AdmZip();
        const keyFrames = [];

        // Setup FFmpeg with Piping and hardware acceleration (nvenc)
        const videoProcess = ffmpeg()
            .input('pipe:0')
            .inputOptions(['-f rawvideo', '-pix_fmt bgra', '-s 1080x1920', `-r ${FPS}`])
            .outputOptions(['-c:v h264_nvenc', '-preset p4', '-rc vbr', '-cq 24', '-pix_fmt yuv420p'])
            .output(outputFilePath);

        let ffmpegInFlight = null;

        const videoPromise = new Promise((resolve, reject) => {
            videoProcess
                .on('start', () => {
                    ffmpegInFlight = videoProcess.ffmpegProc;
                    ffmpegInFlight.stdin.on('error', (err) => {
                        if (err.code !== 'EPIPE') console.error('Pipe Error:', err.message);
                    });
                })
                .on('end', resolve)
                .on('error', reject);
            videoProcess.run();
        });

        // Safe push helper with Backpressure handling
        const pushFrame = async (canvas, fileName = null) => {
            if (!ffmpegInFlight || !ffmpegInFlight.stdin || !ffmpegInFlight.stdin.writable) return;
            const rawBuffer = canvas.toBuffer('raw');
            const canWriteMore = ffmpegInFlight.stdin.write(rawBuffer);
            if (!canWriteMore) {
                await new Promise(res => ffmpegInFlight.stdin.once('drain', res));
            }
            if (fileName) {
                const pngBuffer = canvas.toBuffer('image/png');
                zip.addFile(fileName, pngBuffer);
                if (fileName.includes("message_")) keyFrames.push({ attachment: pngBuffer, name: fileName });
            }
        };

        const renderState = async (opacity = 1.0, currentIdx) => {
            const c = createCanvas(1080, 1920);
            const cx = c.getContext("2d");
            cx.fillStyle = theme.bg;
            cx.fillRect(0, 0, 1080, 1920);

            if (currentIdx === 0) {
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
            while (!ffmpegInFlight) await new Promise(r => setTimeout(r, 50));
            if (i > 0) {
                for (let f = 1; f <= fadeFramesCount; f++) {
                    await pushFrame(await renderState(f / fadeFramesCount, i));
                }
            }
            const canvasHold = await renderState(1.0, i);
            for (let h = 0; h < holdFrames; h++) {
                await pushFrame(canvasHold, h === 0 ? `message_${i + 1}.png` : null);
            }
            const trigger = inlineImages.find(img => img.after === i);
            if (trigger && data.uploadedImages && data.uploadedImages[trigger.file]) {
                const ic = createCanvas(1080, 1920);
                const icx = ic.getContext("2d");
                icx.fillStyle = "#000";
                icx.fillRect(0,0,1080,1920);
                const upImg = await safeLoadImage(data.uploadedImages[trigger.file].url);
                const sc = Math.min(1080 / upImg.width, 1920 / upImg.height);
                icx.drawImage(upImg, (1080 - upImg.width * sc) / 2, (1920 - upImg.height * sc) / 2, upImg.width * sc, upImg.height * sc);
                for (let h = 0; h < holdFrames; h++) await pushFrame(ic, h === 0 ? `inline_${i+1}.png` : null);
            }
        }

        if (ffmpegInFlight && ffmpegInFlight.stdin.writable) ffmpegInFlight.stdin.end();
        await videoPromise;

        // Final UI sending logic
        await message.author.send({ content: `🎬 **Video Ready!**`, files: [{ attachment: outputFilePath, name: 'ios_video.mp4' }] });
        
        if (keyFrames.length > 0) {
            const CHUNK = 10;
            for (let i = 0; i < keyFrames.length; i += CHUNK) {
                await message.author.send({ files: keyFrames.slice(i, i + CHUNK) });
            }
        }

        await message.author.send({ content: `📦 **All Keyframes:**`, files: [{ attachment: zip.toBuffer(), name: `frames.zip` }] });

    } catch (err) {
        console.error("Critical Error:", err);
        await message.reply(`❌ Error: ${err.message}. Ensure hardware acceleration is available.`);
    } finally {
        if (data.txtPath && fs.existsSync(data.txtPath)) fs.unlinkSync(data.txtPath);
        sessions.delete(userId);
    }
}

// ========== BOT EVENTS ==========

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || msg.channel.type !== 1) return;
    let session = sessions.get(msg.author.id);

    if (!session) {
        if (msg.mentions.has(client.user)) {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("start_gen").setLabel("🚀 Start").setStyle(ButtonStyle.Primary));
            return msg.reply({ content: "**iOS DM Maker**", components: [row] });
        }
        return;
    }

    try {
        switch (session.step) {
            case "UPLOAD_TXT":
                const file = msg.attachments.first();
                if (!file?.name.endsWith('.txt')) return msg.reply("❌ Upload .txt");
                const txtPath = path.join('scripts', `${msg.author.id}_${Date.now()}.txt`);
                const res = await fetch(file.url);
                fs.writeFileSync(txtPath, Buffer.from(await res.arrayBuffer()));
                session.data.txtPath = txtPath;
                session.step = "STORY";
                msg.reply("📸 Send Story Image");
                break;
            case "STORY":
                const sImg = msg.attachments.first();
                if (!sImg) return msg.reply("❌ Upload Image");
                session.data.storyImage = sImg.url;
                session.step = "REPEAT";
                msg.reply("🔢 Visible history count?");
                break;
            case "REPEAT":
                session.data.repeat = parseInt(msg.content) || 2;
                session.step = "DURATION";
                msg.reply("⏱ Duration (sec)?");
                break;
            case "DURATION":
                session.data.duration = parseFloat(msg.content) || 1.3;
                session.step = "FADE";
                msg.reply("🌑 Fade duration?");
                break;
            case "FADE":
                session.data.fade = parseFloat(msg.content) || 0;
                const script = fs.readFileSync(session.data.txtPath, 'utf8');
                const req = [...new Set([...script.matchAll(/([^\s<>]+\.(png|jpg|jpeg|gif|webp))/gi)].map(m => m[1]))];
                session.data.required = req;
                if (req.length > 0) {
                    session.step = "MEDIA";
                    msg.reply(`🖼 Send image for: ${req[0]}`);
                } else {
                    msg.reply("🚀 Generating...");
                    await generateVideo(session.data, msg);
                }
                break;
            case "MEDIA":
                const up = msg.attachments.first();
                if (!up) return msg.reply("❌ Upload image");
                const idx = Object.keys(session.data.uploadedImages).length;
                session.data.uploadedImages[session.data.required[idx]] = { url: up.url };
                if (Object.keys(session.data.uploadedImages).length < session.data.required.length) {
                    msg.reply(`✅ Next: ${session.data.required[idx + 1]}`);
                } else {
                    msg.reply("🚀 Generating...");
                    await generateVideo(session.data, msg);
                }
                break;
        }
    } catch (e) { sessions.delete(msg.author.id); }
});

client.on(Events.InteractionCreate, async (i) => {
    if (i.isButton() && i.customId === "start_gen") {
        const menu = new StringSelectMenuBuilder().setCustomId('select_theme').setPlaceholder('Theme').addOptions(
            { label: 'iOS Dark', value: 'ios_dark', emoji: '🌙' },
            { label: 'iOS Light', value: 'ios_light', emoji: '☀️' },
            { label: 'iOS pink', value: 'ios_pink', emoji: '🍓' }
        );
        await i.reply({ content: "🎨 Select Theme", components: [new ActionRowBuilder().addComponents(menu)], flags: 64 });
    }
    if (i.isStringSelectMenu() && i.customId === 'select_theme') {
        sessions.set(i.user.id, { step: "UPLOAD_TXT", data: { theme: i.values[0], uploadedImages: {}, repeat: 2, duration: 1.5, fade: 0.3 }, expires: Date.now() + 600000 });
        await i.update({ content: "✅ Upload .txt script", components: [], flags: 64 });
    }
});

client.once(Events.ClientReady, () => console.log(`✅ Bot ready: ${client.user.tag}`));
client.login(process.env.DISCORD_BOT_TOKEN);