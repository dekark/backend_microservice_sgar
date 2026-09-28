const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

exports.startStorage = async function () {
  const state = {
    objects: new Map(),
    puts: 0,
    failPut: false,
    afterPut: undefined,
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "PUT") {
        if (state.failPut) {
          req.resume();
          res.writeHead(503);
          res.end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (path.includes("/media/")) {
          assert.equal(req.headers["content-type"], "image/webp");
          assert.equal(body.subarray(8, 12).toString(), "WEBP");
        } else {
          assert.ok(path.includes("/files/resources/"));
          assert.equal(req.headers["content-disposition"], "attachment");
        }
        assert.equal(req.headers["x-amz-server-side-encryption"], "AES256");
        assert.equal(req.headers["x-amz-acl"], undefined);
        state.objects.set(path, body);
        state.puts++;
        if (state.afterPut) {
          const callback = state.afterPut;
          state.afterPut = undefined;
          await callback();
        }
        res.writeHead(200, { ETag: '"local-test"' });
        res.end();
      } else if (req.method === "DELETE") {
        state.objects.delete(path);
        res.writeHead(204);
        res.end();
      } else if (req.method === "GET" && state.objects.has(path)) {
        res.writeHead(200, {
          "Content-Type": path.includes("/media/")
            ? "image/webp"
            : "application/octet-stream",
        });
        res.end(state.objects.get(path));
      } else {
        res.writeHead(404);
        res.end();
      }
    })().catch((error) => {
      console.error("Local S3 test server:", error.message);
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    state,
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

exports.testImages = async function ({
  store,
  pool,
  services,
  auth,
  superToken,
  storage,
}) {
  let checks = 0;
  const normalRole = (
    await pool.query("SELECT id FROM roles WHERE name = 'usuario normal'")
  ).rows[0];
  const adminRole = (
    await pool.query("SELECT id FROM roles WHERE name = 'administrador'")
  ).rows[0];
  const area = await store.create("areas", { name: "Imagenes" }, randomUUID());
  const other = await store.create(
    "areas",
    { name: "Otras imagenes" },
    randomUUID(),
  );
  const user = await store.create(
    "users",
    {
      googleSub: "image-owner",
      email: "image-owner@example.com",
      name: "Image owner",
      roleId: normalRole.id,
      areaId: area.id,
    },
    randomUUID(),
  );
  const admin = await store.create(
    "users",
    {
      googleSub: "image-admin",
      email: "image-admin@example.com",
      name: "Image admin",
      roleId: adminRole.id,
      areaId: area.id,
    },
    randomUUID(),
  );
  const outsider = await store.create(
    "users",
    {
      googleSub: "image-outsider",
      email: "image-outsider@example.com",
      name: "Outsider",
      roleId: normalRole.id,
      areaId: other.id,
    },
    randomUUID(),
  );
  const permission = await store.create(
    "permissions",
    { key: "images.area", name: "Image area", module: area.name },
    randomUUID(),
  );
  await store.setRolePermissions(String(adminRole.id), {
    permissionIds: [permission.id],
  });
  const { JwtService } = auth.requireService("@nestjs/jwt");
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  async function sign(person) {
    const sid = randomUUID();
    await pool.query(
      "INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [sid, person.id],
    );
    return jwt.sign(
      { sub: person.id, sid, token_use: "access" },
      {
        algorithm: "HS256",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        expiresIn: 900,
      },
    );
  }
  const normalToken = await sign(user);
  const adminToken = await sign(admin);
  const outsiderToken = await sign(outsider);
  const sharp = services.resources.requireService("sharp");
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  async function call(
    service,
    path,
    method,
    token,
    status,
    file,
    mime = "image/png",
    filename = "untrusted-name.png",
  ) {
    if (token) await delay(550);
    const body = file === undefined ? undefined : new FormData();
    if (body) body.append("file", new Blob([file], { type: mime }), filename);
    const response = await fetch(services[service].base + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const result = response.status === 204 ? undefined : await response.json();
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${JSON.stringify(result)}`,
    );
    checks++;
    return result;
  }
  const avatar = "/users/me/avatar";
  await call("users", avatar, "POST", null, 401, png);
  await call("users", avatar, "GET", normalToken, 404);
  await call("users", avatar, "POST", normalToken, 400);
  await call(
    "users",
    avatar,
    "POST",
    normalToken,
    415,
    Buffer.from("<svg/>"),
    "image/svg+xml",
  );
  await call(
    "users",
    avatar,
    "POST",
    normalToken,
    400,
    Buffer.from("not an image"),
  );
  await call("users", avatar, "POST", normalToken, 415, png, "image/jpeg");
  await call(
    "users",
    avatar,
    "POST",
    normalToken,
    413,
    Buffer.alloc(5 * 1024 * 1024 + 1),
  );
  assert.equal(storage.state.puts, 0);
  const first = await call("users", avatar, "POST", normalToken, 200, png);
  assert.ok(first.key.startsWith(`media/users/${user.id}/`));
  const userRow = await store.get("users", user.id);
  assert.equal(userRow.avatarS3Key, first.key);
  assert.equal(userRow.avatarMimeType, "image/webp");
  const signedAvatar = await call("users", avatar, "GET", normalToken, 200);
  assert.equal(signedAvatar.expiresIn, 300);
  const downloaded = await fetch(signedAvatar.url);
  assert.equal(downloaded.status, 200);
  assert.equal(
    (await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata())
      .format,
    "webp",
  );
  const replaced = await call("users", avatar, "PUT", normalToken, 200, png);
  assert.notEqual(first.key, replaced.key);
  assert.equal(storage.state.objects.has("/media-test/" + first.key), false);
  await call(
    "users",
    `/users/${outsider.id}/avatar`,
    "PUT",
    normalToken,
    403,
    png,
  );
  await call(
    "users",
    `/area-admin/areas/${area.id}/users/${outsider.id}/avatar`,
    "PUT",
    adminToken,
    404,
    png,
  );
  await call(
    "users",
    `/area-admin/areas/${area.id}/users/${admin.id}/avatar`,
    "PUT",
    adminToken,
    403,
    png,
  );
  await call(
    "users",
    `/area-admin/areas/${area.id}/users/${user.id}/avatar`,
    "PUT",
    adminToken,
    200,
    png,
  );
  await call(
    "users",
    `/admin/users/${admin.id}/avatar`,
    "POST",
    superToken,
    200,
    png,
  );
  await call(
    "users",
    `/admin/users/${admin.id}/avatar`,
    "GET",
    superToken,
    200,
  );
  // Own avatar does not require an area assignment.
  await store.update("users", user.id, { areaId: null });
  await call("users", avatar, "PUT", normalToken, 200, png);
  await store.update("users", user.id, { areaId: area.id });

  const resource = await store.create(
    "resources",
    {
      name: "Document with cover",
      type: "DOCUMENT",
      areaId: area.id,
      url: "https://example.com/document.pdf",
      s3Bucket: "documents",
      s3Key: "original.pdf",
    },
    admin.id,
  );
  const foreign = await store.create(
    "resources",
    { name: "Foreign image", type: "IMAGE", areaId: other.id },
    outsider.id,
  );
  const path = `/area-user/areas/${area.id}/resources/${resource.id}/image`;
  await call("resources", path, "GET", normalToken, 404);
  const image = await call("resources", path, "POST", normalToken, 200, png);
  assert.ok(image.key.startsWith(`media/resources/${resource.id}/`));
  const row = await store.get("resources", resource.id);
  assert.equal(row.imageS3Key, image.key);
  assert.equal(row.type, "DOCUMENT");
  assert.equal(row.s3Key, "original.pdf");
  assert.equal(row.url, "https://example.com/document.pdf");
  await call("resources", path, "GET", normalToken, 200);
  await call("resources", path, "PUT", normalToken, 200, png);
  assert.equal(storage.state.objects.has("/media-test/" + image.key), false);
  const writesBeforeDenied = storage.state.puts;
  await call(
    "resources",
    `/area-user/areas/${area.id}/resources/${foreign.id}/image`,
    "PUT",
    normalToken,
    404,
    png,
  );
  await call("resources", path, "GET", outsiderToken, 403);
  await call("resources", path, "DELETE", outsiderToken, 403);
  await call(
    "resources",
    `/admin/resources/${resource.id}/image`,
    "PUT",
    normalToken,
    403,
    png,
  );
  assert.equal(storage.state.puts, writesBeforeDenied);
  await call(
    "resources",
    `/area-admin/areas/${area.id}/resources/${resource.id}/image`,
    "PUT",
    adminToken,
    200,
    png,
  );
  await call(
    "resources",
    `/admin/resources/${resource.id}/image`,
    "PUT",
    superToken,
    200,
    png,
  );
  await call(
    "resources",
    `/resources/${resource.id}/image`,
    "GET",
    superToken,
    200,
  );
  const beforeFailure = (await store.get("resources", resource.id)).imageS3Key;
  storage.state.failPut = true;
  await call("resources", path, "PUT", normalToken, 503, png);
  storage.state.failPut = false;
  assert.equal(
    (await store.get("resources", resource.id)).imageS3Key,
    beforeFailure,
  );
  const count = storage.state.objects.size;
  storage.state.afterPut = () =>
    pool.query("UPDATE users SET area_id = $1 WHERE id = $2", [
      other.id,
      user.id,
    ]);
  await call("resources", path, "PUT", normalToken, 403, png);
  await store.update("users", user.id, { areaId: area.id });
  assert.equal(
    (await store.get("resources", resource.id)).imageS3Key,
    beforeFailure,
  );
  assert.equal(storage.state.objects.size, count); // failed save cleaned up the new blob
  await call("resources", path, "DELETE", normalToken, 204);
  await call("resources", path, "GET", normalToken, 404);
  await call("resources", path, "DELETE", normalToken, 204);
  assert.equal(
    (await store.get("resources", resource.id)).s3Key,
    "original.pdf",
  );
  await call("users", avatar, "DELETE", normalToken, 204);
  await call("users", avatar, "GET", normalToken, 404);
  await call(
    "users",
    `/admin/users/${admin.id}/avatar`,
    "DELETE",
    superToken,
    204,
  );
  // Media endpoints accept every active role, without a module permission.
  const customRole = await store.create(
    "roles",
    { name: "colaborador multimedia" },
    user.id,
  );
  await store.update("users", user.id, { roleId: customRole.id });
  const openImage = `/resources/${resource.id}/image`;
  await call("resources", openImage, "PUT", normalToken, 200, png);
  await call("resources", openImage, "GET", normalToken, 200);
  await call("resources", openImage, "PUT", outsiderToken, 404, png);
  await call("users", avatar, "PUT", normalToken, 200, png);
  const filePath = `/resources/${resource.id}/file`;
  const pdf = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  );
  await call(
    "resources",
    filePath,
    "POST",
    null,
    401,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  await call("resources", filePath, "POST", normalToken, 400);
  const file = await call(
    "resources",
    filePath,
    "POST",
    normalToken,
    200,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  assert.ok(file.key.startsWith(`files/resources/${resource.id}/`));
  assert.equal(file.originalFileName, "manual.pdf");
  assert.equal(file.mimeType, "application/pdf");
  let withFile = await store.get("resources", resource.id);
  const coverKey = withFile.imageS3Key;
  assert.ok(coverKey);
  assert.equal(withFile.s3Key, file.key);
  assert.equal(withFile.url, null);
  const download = await call("resources", filePath, "GET", normalToken, 200);
  const signed = new URL(download.downloadUrl);
  assert.match(
    signed.searchParams.get("response-content-disposition"),
    /^attachment/,
  );
  assert.equal(
    signed.searchParams.get("response-content-type"),
    "application/octet-stream",
  );
  assert.deepEqual(
    Buffer.from(await (await fetch(download.downloadUrl)).arrayBuffer()),
    pdf,
  );
  await call("resources", filePath, "POST", normalToken, 415, png); // not a document
  const replacement = await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    200,
    Buffer.from("name,value\na,1\n"),
    "text/csv",
    "data.csv",
  );
  assert.equal(replacement.mimeType, "text/csv");
  assert.equal(storage.state.objects.has("/media-test/" + file.key), false);
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    200,
    Buffer.from('<?xml version="1.0"?><document>hello</document>'),
    "application/xml",
    "data.xml",
  );
  const beforeFailedPut = (await store.get("resources", resource.id)).s3Key;
  storage.state.failPut = true;
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    503,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  storage.state.failPut = false;
  assert.equal(
    (await store.get("resources", resource.id)).s3Key,
    beforeFailedPut,
  );
  const beforeAreaMoveCount = storage.state.objects.size;
  storage.state.afterPut = () =>
    store.update("users", user.id, { areaId: other.id });
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    404,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  await store.update("users", user.id, { areaId: area.id });
  assert.equal(
    (await store.get("resources", resource.id)).s3Key,
    beforeFailedPut,
  );
  assert.equal(storage.state.objects.size, beforeAreaMoveCount);
  await call("resources", filePath, "GET", outsiderToken, 404);
  await call("resources", filePath, "DELETE", outsiderToken, 404);
  await call(
    "resources",
    filePath,
    "PUT",
    outsiderToken,
    404,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    413,
    Buffer.alloc(25 * 1024 * 1024 + 1),
    "application/octet-stream",
    "large.bin",
  );
  const beforeTypeChange = (await store.get("resources", resource.id)).s3Key;
  const objectCount = storage.state.objects.size;
  storage.state.afterPut = () =>
    store.update("resources", resource.id, { type: "IMAGE" });
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    409,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  assert.equal(storage.state.objects.size, objectCount);
  assert.equal(
    (await store.get("resources", resource.id)).s3Key,
    beforeTypeChange,
  );
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    415,
    pdf,
    "application/pdf",
    "manual.pdf",
  );
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    200,
    png,
    "application/octet-stream",
    "photo.png",
  );
  assert.equal(
    (await store.get("resources", resource.id)).mimeType,
    "image/png",
  );
  const arbitrary = Buffer.from([0, 1, 2, 3, 255, 90]);
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    200,
    Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ),
    "image/svg+xml",
    "drawing.svg",
  );
  assert.equal(
    (await store.get("resources", resource.id)).mimeType,
    "image/svg+xml",
  );
  await call(
    "resources",
    `/admin/resources/${resource.id}/file`,
    "GET",
    normalToken,
    403,
  );
  await call(
    "resources",
    `/admin/resources/${resource.id}/file`,
    "GET",
    superToken,
    200,
  );
  await call(
    "resources",
    `/area-admin/areas/${area.id}/resources/${resource.id}/file`,
    "GET",
    adminToken,
    200,
  );
  await call(
    "resources",
    `/area-user/areas/${area.id}/resources/${resource.id}/file`,
    "GET",
    normalToken,
    200,
  );
  for (const type of ["FILE", "SOFTWARE", "LICENSE", "EQUIPMENT", "OTHER"]) {
    await store.update("resources", resource.id, { type });
    await call(
      "resources",
      filePath,
      "PUT",
      normalToken,
      200,
      arbitrary,
      "application/octet-stream",
      "content.bin",
    );
  }
  await store.update("resources", resource.id, { type: "VIDEO" });
  await call("resources", filePath, "PUT", normalToken, 415, png);
  // Minimal MP4 container header, sufficient for category detection (not a playback validator).
  const mp4 = Buffer.from(
    "00000018667479706d703432000000006d70343269736f6d",
    "hex",
  );
  await call(
    "resources",
    filePath,
    "PUT",
    normalToken,
    200,
    mp4,
    "video/mp4",
    "clip.mp4",
  );
  await store.update("resources", resource.id, { type: "LINK" });
  await call("resources", filePath, "PUT", normalToken, 400, png);
  async function urlCall(body, status, token = normalToken) {
    await delay(550);
    const res = await fetch(
      services.resources.base + `/resources/${resource.id}/url`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const result = await res.json();
    assert.equal(res.status, status, JSON.stringify(result));
    checks++;
  }
  await urlCall({ url: "javascript:alert(1)" }, 400);
  await urlCall({ url: "https://user:password@example.com" }, 400);
  await urlCall({ url: null }, 400);
  await urlCall({ url: "https://example.com", s3Key: "forged" }, 400);
  await urlCall({ url: "https://example.com/video.mp4" }, 404, outsiderToken);
  const keyBeforeUrl = (await store.get("resources", resource.id)).s3Key;
  await urlCall({ url: "https://example.com/video.mp4" }, 200);
  withFile = await store.get("resources", resource.id);
  assert.equal(withFile.s3Key, null);
  assert.equal(withFile.url, "https://example.com/video.mp4");
  assert.equal(withFile.imageS3Key, coverKey);
  assert.equal(storage.state.objects.has("/media-test/" + keyBeforeUrl), false);
  assert.equal(
    (await call("resources", filePath, "GET", normalToken, 200)).url,
    "https://example.com/video.mp4",
  );
  await call("resources", filePath, "DELETE", normalToken, 204);
  await call("resources", filePath, "GET", normalToken, 404);
  await call("resources", filePath, "DELETE", normalToken, 204);
  await store.update("users", user.id, { areaId: null });
  await call("resources", filePath, "GET", normalToken, 403);
  await call("users", avatar, "PUT", normalToken, 200, png);
  await store.update("users", user.id, { areaId: area.id });
  await call("resources", openImage, "DELETE", normalToken, 204);
  console.log(
    `OK: ${checks} media HTTP checks with real image decoding, file detection, PostgreSQL and AWS SDK against local S3 simulation.`,
  );
  return checks;
};
