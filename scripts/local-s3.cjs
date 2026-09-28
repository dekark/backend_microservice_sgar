const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const PORT = parseInt(process.env.S3_PORT || '9000', 10);
const STORAGE_DIR = process.env.S3_STORAGE_DIR || path.join(__dirname, '../local-storage');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function getFilePath(urlPath) {
  // Normalize key by removing query params and leading slashes
  const cleanPath = urlPath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  return path.join(STORAGE_DIR, cleanPath);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // Healthcheck or root probe
  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  const targetFile = getFilePath(pathname);

  try {
    if (req.method === 'PUT') {
      const parentDir = path.dirname(targetFile);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(targetFile, buffer);

      // Save metadata like Content-Type if provided
      const meta = {
        contentType: req.headers['content-type'] || 'application/octet-stream',
        contentDisposition: req.headers['content-disposition'] || null,
        size: buffer.length,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(`${targetFile}.meta.json`, JSON.stringify(meta));

      const etag = '"' + createHash('md5').update(buffer).digest('hex') + '"';
      res.writeHead(200, {
        'ETag': etag,
        'x-amz-server-side-encryption': 'AES256',
        'Content-Type': 'application/xml',
      });
      res.end('<PutObjectResult/>');
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      let meta = {};
      if (fs.existsSync(`${targetFile}.meta.json`)) {
        try {
          meta = JSON.parse(fs.readFileSync(`${targetFile}.meta.json`, 'utf8'));
        } catch (_) {}
      }

      const disposition = parsedUrl.searchParams.get('response-content-disposition') || meta.contentDisposition || 'inline';
      const contentType = parsedUrl.searchParams.get('response-content-type') || meta.contentType || (pathname.includes('/media/') ? 'image/webp' : 'application/octet-stream');

      const stat = fs.statSync(targetFile);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=300',
        'x-amz-server-side-encryption': 'AES256'
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(targetFile);
      stream.pipe(res);
      return;
    }

    if (req.method === 'DELETE') {
      if (fs.existsSync(targetFile)) {
        try { fs.unlinkSync(targetFile); } catch (_) {}
      }
      if (fs.existsSync(`${targetFile}.meta.json`)) {
        try { fs.unlinkSync(`${targetFile}.meta.json`); } catch (_) {}
      }
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  } catch (err) {
    console.error('Local S3 error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err.message || 'Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local S3 Storage server running on http://0.0.0.0:${PORT} (Storage: ${STORAGE_DIR})`);
});
