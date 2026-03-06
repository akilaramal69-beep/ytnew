require('dotenv').config();
const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

function getYtdlpCommand() {
    return process.env.YTDLP_PATH || 'yt-dlp';
}

async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const cmd = `${getYtdlpCommand()} --dump-json --no-download "${url}"`;
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const info = JSON.parse(stdout);
                resolve(info);
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function getFormats(url) {
    return new Promise((resolve, reject) => {
        const cmd = `${getYtdlpCommand()} --dump-json --no-download --flat "${url}"`;
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const info = JSON.parse(stdout);
                const formats = info.formats || [];
                const filtered = formats.map(f => ({
                    format_id: f.format_id,
                    ext: f.ext,
                    resolution: f.resolution || 'audio only',
                    filesize: f.filesize,
                    fmt_note: f.format_note,
                    vcodec: f.vcodec,
                    acodec: f.acodec
                })).filter(f => f.ext === 'mp4' || f.ext === 'webm' || f.ext === 'm4a');
                resolve({
                    title: info.title,
                    thumbnail: info.thumbnail,
                    duration: info.duration,
                    uploader: info.uploader,
                    formats: filtered
                });
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function downloadVideo(url, formatId, res) {
    const filename = `video_${Date.now()}`;
    const outputPath = path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s');
    
    return new Promise((resolve, reject) => {
        const args = [
            '-f', formatId || 'best',
            '-o', outputPath,
            '--no-playlist',
            '--no-warnings',
            '--progress',
            url
        ];
        
        const proc = spawn(getYtdlpCommand(), args);
        let stderr = '';
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            const progressMatch = data.toString().match(/(\d+\.?\d*)%/);
            if (progressMatch && res) {
                res.write(`data: ${progressMatch[1]}\n\n`);
            }
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                const files = fs.readdirSync(DOWNLOAD_DIR);
                const downloadedFile = files.find(f => f.startsWith('video_') || f.includes('.'));
                if (downloadedFile) {
                    resolve(path.join(DOWNLOAD_DIR, downloadedFile));
                } else {
                    reject(new Error('Download failed'));
                }
            } else {
                reject(new Error(stderr || 'Download failed'));
            }
        });
        
        proc.on('error', reject);
    });
}

app.get('/', (req, res) => {
    res.render('index', { 
        title: 'YouTube Downloader API',
        apiUrl: process.env.API_URL || `http://localhost:${PORT}`
    });
});

app.get('/api/info', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        const info = await getVideoInfo(url);
        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            uploader: info.uploader,
            description: info.description,
            view_count: info.view_count,
            upload_date: info.upload_date
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/formats', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        const formats = await getFormats(url);
        res.json(formats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/download', async (req, res) => {
    try {
        const { url, formatId } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const filePath = await downloadVideo(url, formatId, res);
        
        res.write('data: done\n\n');
        
        res.download(filePath, path.basename(filePath), (err) => {
            if (err) console.error('Download error:', err);
            fs.remove(filePath).catch(() => {});
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, formatId } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const filePath = await downloadVideo(url, formatId, res);
        
        res.write('data: done\n\n');
        
        res.download(filePath, path.basename(filePath), (err) => {
            if (err) console.error('Download error:', err);
            fs.remove(filePath).catch(() => {});
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube Downloader API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', () => {
    console.log('Cleaning up...');
    fs.remove(DOWNLOAD_DIR).catch(() => {});
    process.exit(0);
});
