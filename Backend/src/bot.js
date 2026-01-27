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
};

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
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('video')) {
            throw new Error('Attempted to load a video as an image.');
        }

        const buffer = await response.arrayBuffer();
        const img = await loadImage(Buffer.from(buffer));
        return img;
    } catch (error) {
        console.error("Image Load Error:", error.message);
        const canvas = createCanvas(100, 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 100, 100);
        return canvas;
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
    } ;

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
        const inlineImages = [];

        lines.forEach(l => {
            const m = l.match(/([^\s<>]+\.(png|jpg|jpeg|gif|webp))\s*<([\d.]+)s>/i);
            if (m) inlineImages.push({ after: parsed.length - 1, file: m[1] });
            else parsed.push({ side: l.startsWith("R") ? "right" : "left", text: l.replace(/^(R\)|L\))\s*/, "") });
        });

        if (parsed.length === 0) throw new Error("No valid messages.");

        let fIdx = 0;
        const framePaths = [];
        const FPS = 30; 
        const messageDuration = data.duration || 1.3; 
        const holdFrames = Math.floor(messageDuration * FPS);
        const fadeFramesCount = 10; 
        
        const previewFrames = [];

        const saveFrame = (canvas, isKeyFrame = false) => {
            const fPath = path.join(userTemp, `frame_${fIdx++}.png`);
            const buffer = canvas.toBuffer();
            fs.writeFileSync(fPath, buffer);
            framePaths.push(fPath);
            
            if (isKeyFrame) {
                previewFrames.push({
                    buffer: buffer,
                    name: `message_${previewFrames.length + 1}.png`
                });
            }
        };

        // --- RENDER FUNCTION ---
        const renderState = async (opacity = 1.0, currentIdx) => {
            const c = createCanvas(1080, 1920);
            const cx = c.getContext("2d");
            cx.fillStyle = theme.bg;
            cx.fillRect(0, 0, 1080, 1920);

            // If it's the very first message index, show Scroll Bar and Story UI
            if (currentIdx === 0) {
                // DRAW SCROLL BAR ONLY ON FIRST FRAME
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
                // Normal chat evolution for all subsequent messages (No Scroll Bar)
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
            if (i > 0) {
                for (let f = 1; f <= fadeFramesCount; f++) {
                    const canvasFade = await renderState(f / fadeFramesCount, i);
                    saveFrame(canvasFade);
                }
            }

            const canvasHold = await renderState(1.0, i);
            for (let h = 0; h < holdFrames; h++) {
                saveFrame(canvasHold, h === 0);
            }

            const trigger = inlineImages.find(img => img.after === i);
            if (trigger && data.uploadedImages && data.uploadedImages[trigger.file]) {
                const ic = createCanvas(1080, 1920);
                const icx = ic.getContext("2d");
                icx.fillStyle = "#000";
                const upImg = await safeLoadImage(data.uploadedImages[trigger.file].url);
                const sc = Math.min(1080 / upImg.width, 1920 / upImg.height);
                icx.drawImage(upImg, (1080 - upImg.width * sc) / 2, (1920 - upImg.height * sc) / 2, upImg.width * sc, upImg.height * sc);
                
                for (let h = 0; h < holdFrames; h++) {
                    saveFrame(ic, h === 0);
                }
            }
        };

        const output = path.join('output', `${userId}_${Date.now()}.mp4`);
        
        await new Promise((res, rej) => {
            ffmpeg()
                .input(path.join(userTemp, 'frame_%d.png'))
                .inputFPS(FPS)
                .outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-crf 18', '-preset fast'])
                .output(output)
                .on('end', res)
                .on('error', rej)
                .run();
        });

        await message.author.send({ 
            content: `✅ **Video Generated Successfully!**`, 
            files: [{ attachment: output, name: 'ios_dm_video.mp4' }] 
        });

        if (previewFrames.length > 0) {
            const chunkSize = 5;
            for (let i = 0; i < previewFrames.length; i += chunkSize) {
                const chunk = previewFrames.slice(i, i + chunkSize);
                await message.author.send({
                    content: i === 0 ? `**🖼️ Message Frame Previews:**` : `**More Previews...**`,
                    files: chunk.map(f => ({ attachment: f.buffer, name: f.name }))
                }).catch(e => console.error("Error sending frame chunk:", e.message));
            }
        }

    } catch (err) {
        console.error("Error:", err);
        await message.reply(`❌ Video Error: ${err.message}`);
    } finally {
        if (fs.existsSync(userTemp)) fs.rmSync(userTemp, { recursive: true, force: true });
        if (data.txtPath && fs.existsSync(data.txtPath)) fs.unlinkSync(data.txtPath);
        sessions.delete(userId);
    }
};

// ========== BOT EVENTS ==========

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || msg.channel.type !== 1) return;
    let session = sessions.get(msg.author.id);

    if (!session) {
        if (msg.mentions.has(client.user)) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("start_gen").setLabel("🚀 Start iOS DM Maker").setStyle(ButtonStyle.Primary).setEmoji("📱")
            );
            return msg.reply({ content: "**iOS DM Maker**", components: [row] });
        }
        return;
    };

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
                if (!sImg || !sImg.contentType?.startsWith('image/')) return msg.reply("❌ Please upload an IMAGE file (PNG/JPG).");
                session.data.storyImage = sImg.url;
                session.step = "REPEAT";
                msg.reply("🔢 **Step 3:** How many previous messages should show?");
                break;
                
            case "REPEAT":
                const r = parseInt(msg.content);
                if (isNaN(r)) return msg.reply("❌ Enter a number.");
                session.data.repeat = r;
                session.step = "DURATION";
                msg.reply("⏱ **Step 4:** Duration per message (seconds)?");
                break;
                
            case "DURATION":
                const d = parseFloat(msg.content);
                if (isNaN(d)) return msg.reply("❌ Enter a number.");
                session.data.duration = d;
                session.step = "FADE";
                msg.reply("🌑 **Step 5:** Fade duration?");
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
                    msg.reply("🚀 Processing...");
                    await generateVideo(session.data, msg);
                }
                break;
                
            case "MEDIA":
                const up = msg.attachments.first();
                if (!up || !up.contentType?.startsWith('image/')) return msg.reply("❌ Please upload an IMAGE.");
                const idx = Object.keys(session.data.uploadedImages).length;
                session.data.uploadedImages[session.data.required[idx]] = { url: up.url };
                
                if (Object.keys(session.data.uploadedImages).length < session.data.required.length) {
                    msg.reply(`✅ Next: **${session.data.required[idx + 1]}**`);
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
        const menu = new StringSelectMenuBuilder()
            .setCustomId('select_theme').setPlaceholder('Theme')
            .addOptions(
                { label: 'iOS Dark', value: 'ios_dark', emoji: '🌙' },
                { label: 'iOS Light', value: 'ios_light', emoji: '☀️' },
                { label: 'iOS pink', value: 'ios_pink', emoji: '🍓' }
            );
        await i.reply({ content: "🎨 **Select Theme**", components: [new ActionRowBuilder().addComponents(menu)], flags: 64 });
    }
    if (i.isStringSelectMenu() && i.customId === 'select_theme') {
        sessions.set(i.user.id, { step: "UPLOAD_TXT", data: { theme: i.values[0], uploadedImages: {}, repeat: 2, duration: 1.5, fade: 0.3 }, expires: Date.now() + 600000 });
        await i.update({ content: "✅ Theme set. **Upload your .txt script now.**", components: [], flags: 64 });
    }
});

client.once(Events.ClientReady, () => console.log(`✅ Bot ready: ${client.user.tag}`));
client.login(process.env.DISCORD_BOT_TOKEN);



