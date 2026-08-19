// UPLOAD_ROOT production guard — server/config/paths.js.
//
// Outside production an unset UPLOAD_ROOT falls back to the committed tree under
// public/assets, which is what local dev wants. In production that fallback is a
// silent data-loss trap: uploads land on the container's ephemeral disk and
// vanish on the next redeploy. Both App Services set UPLOAD_ROOT to the Azure
// Files mount, so an unset value means the mount config was lost — fail the boot.
const path = require('path');

const PATHS_MODULE = '../../server/config/paths';

describe('paths.js — UPLOAD_ROOT production guard', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...savedEnv };
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('throws at require time when NODE_ENV=production and UPLOAD_ROOT is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPLOAD_ROOT;

    expect(() => require(PATHS_MODULE)).toThrow(/UPLOAD_ROOT must be set/);
  });

  it('loads in production when UPLOAD_ROOT is set, and resolves paths under it', () => {
    process.env.NODE_ENV = 'production';
    process.env.UPLOAD_ROOT = path.join(path.sep, 'app', 'uploads');

    const paths = require(PATHS_MODULE);

    expect(paths.UPLOAD_ROOT).toBe(path.resolve(path.join(path.sep, 'app', 'uploads')));
    expect(paths.contentUploadDir()).toBe(path.join(paths.UPLOAD_ROOT, 'content'));
    expect(paths.productUploadDir('42')).toBe(path.join(paths.UPLOAD_ROOT, 'products', '42'));
  });

  it('falls back to the committed public/assets tree outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.UPLOAD_ROOT;

    const paths = require(PATHS_MODULE);

    expect(paths.UPLOAD_ROOT.endsWith(path.join('public', 'assets'))).toBe(true);
  });
});
