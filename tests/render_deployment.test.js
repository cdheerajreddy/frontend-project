import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchRoute } from '../server/router.js';
import {
  getDatabase,
  closeDatabase,
  getDataFilePath,
  initAdmin,
  createStudentWithPortfolio,
  getPortfolioByUserId,
  updateStudentPortfolio,
  publishPortfolio,
  unpublishPortfolio,
  getPublicPortfolioByUsername,
  getUserByUsername
} from '../server/db/database.js';
import { getSessionSecret } from '../server/middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RENDER_TEST_DIR = path.resolve(__dirname, '../data/test_render_dir');
const RENDER_TEST_DB = path.join(RENDER_TEST_DIR, 'portfolio-data.json');
const TEST_PORT = 5065;

// Helper: HTTP request promisifier
function request(options, postData, cookie = null, csrfToken = null) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (cookie) headers['Cookie'] = cookie;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json || data,
          rawBody: data
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

function extractCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const cookieStr = Array.isArray(raw) ? raw[0] : raw;
  return cookieStr.split(';')[0];
}

async function runRenderDeploymentTests() {
  console.log('\n=============================================================');
  console.log('--- Testing Full-Stack Render Deployment Architecture ---');
  console.log('=============================================================');

  // Setup isolated persistent directory
  if (fs.existsSync(RENDER_TEST_DIR)) {
    fs.rmSync(RENDER_TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(RENDER_TEST_DIR, { recursive: true });

  // Configure environment variables for Render testing
  process.env.DATA_DIR = RENDER_TEST_DIR;
  delete process.env.DATA_FILE_PATH;
  process.env.ADMIN_USERNAME = 'render_admin';
  process.env.ADMIN_PASSWORD = 'RenderAdminSecureSecret2026!';
  process.env.SESSION_SECRET = 'render_test_session_secret_at_least_32_characters_long_1234567890';
  process.env.NODE_ENV = 'production';

  // 1. DATA_DIR resolution tests
  console.log('\n1. Testing DATA_DIR Configuration & Resolution...');
  const resolvedDbPath = getDataFilePath();
  assert.equal(resolvedDbPath, RENDER_TEST_DB, 'DATA_DIR correctly resolves portfolio-data.json inside directory');

  // Simulate /var/data in POSIX
  const originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = '/var/data';
  const varDataPath = getDataFilePath();
  assert.equal(varDataPath, '/var/data/portfolio-data.json', 'DATA_DIR=/var/data resolves to /var/data/portfolio-data.json');
  process.env.DATA_DIR = originalDataDir;
  console.log('DATA_DIR resolution: PASS');

  // 2. Production startup security checks
  console.log('\n2. Testing Production Startup Security Enforcements...');
  // A. SESSION_SECRET minimum length
  const validSecret = getSessionSecret();
  assert.ok(validSecret.length >= 32, 'Session secret meets production 32+ char requirement');

  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'short_secret';
  assert.throws(
    () => getSessionSecret(),
    /SESSION_SECRET must be configured with at least 32/,
    'Production startup fails closed if SESSION_SECRET is too short'
  );
  process.env.SESSION_SECRET = oldSecret;

  // B. Admin credentials requirement in production
  const oldAdminPass = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  await assert.rejects(
    async () => initAdmin(),
    /ADMIN_USERNAME and ADMIN_PASSWORD must be configured/,
    'Production startup fails closed if admin credentials are missing'
  );
  process.env.ADMIN_PASSWORD = oldAdminPass;

  // Initialize DB and Admin in test dir
  getDatabase();
  await initAdmin();
  console.log('Production startup security enforcements: PASS');

  // Start HTTP Server
  const server = http.createServer(async (req, res) => {
    try {
      await dispatchRoute(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, '0.0.0.0', resolve));
  console.log(`Test server successfully listening on 0.0.0.0:${TEST_PORT}`);

  try {
    // 3. Health check endpoint: GET /api/health
    console.log('\n3. Testing GET /api/health (Render Health Probe)...');
    const healthRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/health',
      method: 'GET'
    });
    assert.equal(healthRes.statusCode, 200, 'Health check returns HTTP 200');
    assert.equal(healthRes.body.status, 'healthy', 'Health check reports status: healthy');
    assert.equal(healthRes.body.environment, 'production', 'Health check reports production environment');
    assert.ok(healthRes.body.uptime, 'Health check includes uptime metric');
    assert.ok(healthRes.body.runtime?.node, 'Health check includes node runtime info');
    console.log('Health endpoint: PASS');

    // 4. Same-origin static assets & SPA fallback
    console.log('\n4. Testing Same-Origin Built Frontend & Dist Protection...');
    // A. Root serves index.html
    const rootRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/',
      method: 'GET'
    });
    assert.equal(rootRes.statusCode, 200, 'GET / serves built index.html');
    assert.ok(rootRes.rawBody.includes('Personal Portfolio'), 'Served root contains portfolio title');

    // B. Extensionless SPA route falls back to index.html
    const spaRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/demo',
      method: 'GET'
    });
    assert.equal(spaRes.statusCode, 200, 'GET /demo falls back to index.html for client-side routing');

    // C. JSON database file is strictly blocked from public HTTP access
    const dbProbeRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/portfolio-data.json',
      method: 'GET'
    });
    assert.equal(dbProbeRes.statusCode, 404, 'Direct access to portfolio-data.json is blocked with 404');

    const dbSubDirRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/data/portfolio-data.json',
      method: 'GET'
    });
    assert.equal(dbSubDirRes.statusCode, 404, 'Direct access to /data/portfolio-data.json is blocked with 404');
    console.log('Same-origin static assets & data protection: PASS');

    // 5. Student Registration Flow
    console.log('\n5. Testing Student Registration (POST /api/auth/register)...');
    const studentUser = 'render_student_2026';
    const regRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      {
        username: studentUser,
        password: 'ValidStudentPass123!',
        fullName: 'Render Student'
      }
    );

    assert.equal(regRes.statusCode, 201, 'Student registration returns HTTP 201 Created');
    assert.equal(regRes.body.success, true, 'Registration reports success');
    assert.equal(regRes.body.user.username, studentUser);
    assert.equal(regRes.body.user.role, 'student');
    assert.ok(regRes.body.csrfToken, 'CSRF token returned upon registration');

    const studentCookie = extractCookie(regRes);
    assert.ok(studentCookie, 'Session cookie set upon registration');
    const studentCsrf = regRes.body.csrfToken;
    console.log('Student registration: PASS');

    // 6. Administrator Login Flow
    console.log('\n6. Testing Administrator Login (POST /api/auth/login)...');
    const adminLoginRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      {
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD
      }
    );

    assert.equal(adminLoginRes.statusCode, 200, 'Admin login returns HTTP 200');
    assert.equal(adminLoginRes.body.success, true);
    assert.equal(adminLoginRes.body.user.role, 'admin');
    assert.ok(adminLoginRes.body.csrfToken);

    const adminCookie = extractCookie(adminLoginRes);
    assert.ok(adminCookie, 'Admin session cookie set');

    // Verify Admin Overview endpoint
    const adminOverviewRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/admin/overview',
        method: 'GET'
      },
      null,
      adminCookie
    );
    assert.equal(adminOverviewRes.statusCode, 200);
    assert.ok(adminOverviewRes.body.totalStudents >= 1);
    console.log('Administrator login & overview: PASS');

    // 7. Portfolio Operations (GET, PUT, Publish, Public View, Unpublish)
    console.log('\n7. Testing Student Portfolio Lifecycle (GET, PUT, Publish, Public View, Unpublish)...');
    // A. GET /api/student/portfolio
    const getPortRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/student/portfolio',
        method: 'GET'
      },
      null,
      studentCookie
    );
    assert.equal(getPortRes.statusCode, 200);
    assert.equal(getPortRes.body.portfolio.slug, studentUser);

    // B. PUT /api/student/portfolio
    const updatePortRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/student/portfolio',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      },
      {
        fullName: 'Render Student',
        headline: 'Full-Stack Software Engineer',
        bioIntro: 'Building scalable microservices with native Node.js.',
        degree: 'Bachelor of Science in Computer Science',
        institution: 'Render University',
        academicPeriod: '2022 - 2026',
        location: 'San Francisco, CA',
        contactEmail: 'student@example.com',
        showEmailPublicly: false,
        interests: ['Web Development', 'Cloud Architecture'],
        skills: ['JavaScript', 'Node.js', 'React', 'Docker'],
        projects: [
          {
            title: 'Native Cloud Service',
            description: 'Deployed on Render with persistent disk.',
            technologies: ['Node.js', 'HTTP']
          }
        ]
      },
      studentCookie,
      studentCsrf
    );
    assert.equal(updatePortRes.statusCode, 200, 'Portfolio updated successfully');
    assert.equal(updatePortRes.body.portfolio.headline, 'Full-Stack Software Engineer');

    // C. Publish Portfolio (POST /api/student/portfolio/publish)
    const pubRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/student/portfolio/publish',
        method: 'POST'
      },
      null,
      studentCookie,
      studentCsrf
    );
    assert.equal(pubRes.statusCode, 200);
    assert.equal(pubRes.body.isPublished, true);

    // D. Public View: GET /api/p/:username (No auth required)
    const publicRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/p/${studentUser}`,
      method: 'GET'
    });
    assert.equal(publicRes.statusCode, 200, 'Public view of published portfolio returns HTTP 200');
    assert.equal(publicRes.body.portfolio.headline, 'Full-Stack Software Engineer');
    assert.equal(publicRes.body.portfolio.skills.length, 4);
    assert.equal(publicRes.body.portfolio.contactEmail, null, 'Private email is withheld when showEmailPublicly=false');
    assert.equal(publicRes.body.portfolio.password_hash, undefined, 'Password hash is strictly omitted from public portfolio');

    // E. Unpublish Portfolio (POST /api/student/portfolio/unpublish)
    const unpubRes = await request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/student/portfolio/unpublish',
        method: 'POST'
      },
      null,
      studentCookie,
      studentCsrf
    );
    assert.equal(unpubRes.statusCode, 200);
    assert.equal(unpubRes.body.isPublished, false);

    // After unpublishing, public view must return 404
    const unpubPublicRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/p/${studentUser}`,
      method: 'GET'
    });
    assert.equal(unpubPublicRes.statusCode, 404, 'Unpublished portfolio returns 404 to public requests');
    console.log('Student portfolio lifecycle: PASS');

    // 8. JSON File Persistence Across Disk Reload
    console.log('\n8. Testing JSON File Persistence Across Database Reload...');
    // Verify file exists on disk
    assert.ok(fs.existsSync(RENDER_TEST_DB), 'portfolio-data.json exists on disk in DATA_DIR');
    const rawDiskContent = fs.readFileSync(RENDER_TEST_DB, 'utf8');
    const parsedDisk = JSON.parse(rawDiskContent);
    assert.ok(parsedDisk.users.some((u) => u.username === studentUser), 'Student record is persisted in JSON file');
    assert.ok(parsedDisk.portfolios.some((p) => p.slug === studentUser), 'Portfolio record is persisted in JSON file');

    // Close and reload DB
    closeDatabase();
    const reloadedStore = getDatabase();
    assert.ok(reloadedStore.users.some((u) => u.username === studentUser), 'Student record persists after closeDatabase and reload');
    assert.ok(reloadedStore.portfolios.some((p) => p.slug === studentUser), 'Portfolio record persists after closeDatabase and reload');
    console.log('JSON file persistence across disk reload: PASS');

    console.log('\n=============================================================');
    console.log('All Full-Stack Render Deployment Tests PASSED Successfully!');
    console.log('=============================================================\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    if (fs.existsSync(RENDER_TEST_DIR)) {
      try {
        fs.rmSync(RENDER_TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

runRenderDeploymentTests().catch((err) => {
  console.error('\nFatal test failure in render_deployment.test.js:', err);
  process.exit(1);
});
