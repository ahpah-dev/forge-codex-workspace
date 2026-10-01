import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/plugin-protocol.js';
const forms = globalThis.ForgePluginForms;
const schema = { type: 'object', properties: { enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 0, maximum: 5 }, region: { type: 'string', enum: ['eu', 'us'] }, scopes: { type: 'array', items: { enum: ['read', 'write'] }, minItems: 1 } }, required: ['enabled', 'count', 'region', 'scopes'] };
test('plugin forms retain false, zero, enums, and multiple choices', () => {
  assert.deepEqual({ ...forms.validate(schema, { enabled: false, count: 0, region: 'eu', scopes: ['read'] }) }, { enabled: false, count: 0, region: 'eu', scopes: ['read'] });
});
test('invalid or missing required plugin input cannot be accepted', () => {
  const valid = { enabled: true, count: 1, region: 'eu', scopes: ['read'] };
  for (const invalid of [{ ...valid, count: 6 }, { ...valid, region: 'other' }, { ...valid, scopes: [] }, { ...valid, enabled: 'true' }, {}]) assert.throws(() => forms.validate(schema, invalid));
});
test('unsupported schemas fail clearly rather than accepting a blank form', () => {
  assert.throws(() => forms.fields({ type: 'object', properties: { config: { type: 'object' } } }), /unsupported field/);
  assert.throws(() => forms.fields({ type: 'array' }), /cannot render/);
});
