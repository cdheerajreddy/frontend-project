import assert from 'node:assert/strict';
import { normalizePath, withBase, getRouterBase, isStaticDemoMode } from '../src/router/routerUtils.js';

console.log('--- Testing Custom History API Router & GitHub Pages Path Normalization ---');

// Test 1: Fallback when no base is configured (localhost)
console.log('1. Testing local environment routing (no base)...');
assert.equal(normalizePath('/'), '/');
assert.equal(normalizePath('/demo'), '/demo');
assert.equal(normalizePath('/demo/'), '/demo');
assert.equal(normalizePath('/p/student_1'), '/p/student_1');
console.log('Local environment routing: PASS');

// Test 2: GitHub Pages base handling simulation
console.log('\n2. Testing GitHub Pages /frontend-project base resolution...');
// Simulate GitHub Pages environment
globalThis.window = {
  location: {
    hostname: 'cdheerajreddy.github.io',
    pathname: '/frontend-project/demo'
  }
};

assert.equal(getRouterBase(), '/frontend-project');
assert.equal(normalizePath('/frontend-project'), '/');
assert.equal(normalizePath('/frontend-project/'), '/');
assert.equal(normalizePath('/frontend-project/demo'), '/demo');
assert.equal(normalizePath('/frontend-project/demo/'), '/demo');
assert.equal(normalizePath('/frontend-project/p/alex_test'), '/p/alex_test');
assert.equal(normalizePath('/frontend-project/login'), '/login');
assert.equal(normalizePath('/frontend-project/admin'), '/admin');
console.log('Path normalization with repository base: PASS');

// Test 3: withBase helper
console.log('\n3. Testing withBase URL generation for internal navigation...');
assert.equal(withBase('/'), '/frontend-project/');
assert.equal(withBase('/demo'), '/frontend-project/demo');
assert.equal(withBase('/login'), '/frontend-project/login');
assert.equal(withBase('/p/alex_test'), '/frontend-project/p/alex_test');
assert.equal(withBase('/frontend-project/demo'), '/frontend-project/demo', 'Does not duplicate prefix');
assert.equal(withBase('#projects'), '#projects', 'Preserves hash anchors');
assert.equal(withBase('https://github.com'), 'https://github.com', 'Preserves external URLs');
console.log('withBase internal and external URL generation: PASS');

// Test 4: Static demo mode detection
console.log('\n4. Testing isStaticDemoMode detection...');
assert.equal(isStaticDemoMode(), true);
console.log('Static demo detection on GitHub Pages: PASS');

// Reset window
delete globalThis.window;

console.log('\nAll History API Router tests passed successfully!');
