/**
 * Every GitHub Actions workflow must be valid YAML with the shape Actions
 * expects. GitHub reports a broken workflow only when it is triggered — for
 * the dispatch-only deploy.yml that means the moment someone tries to ship.
 *
 * Found 2026-09-24 (rekstrarkerfid's engine sync): harvest chunk F inserted
 * the build-tag health check with String.prototype.replace, and the `$'` in
 * the shell pattern `grep -Eq '^[0-9]+$'` was read as "the text after the
 * match" — the alert-deploy-failed job got pasted into the middle of a line
 * and deploy.yml stopped parsing. The lesson for scripted edits is in
 * LESSONS.md; this test is the net.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DIR = path.join(__dirname, '../../.github/workflows');
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();

describe('GitHub Actions workflows', () => {
  test('the directory has workflows (guard)', () => {
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'deploy.yml']));
  });

  test.each(files)('%s parses and has the shape Actions expects', (file) => {
    const doc = yaml.load(fs.readFileSync(path.join(DIR, file), 'utf8'));
    expect(doc && typeof doc).toBe('object');
    expect(typeof doc.name).toBe('string');
    expect(doc.on || doc[true]).toBeTruthy(); // YAML 1.1 reads a bare `on:` key as true
    expect(doc.jobs && typeof doc.jobs).toBe('object');
    for (const [id, job] of Object.entries(doc.jobs)) {
      expect({ id, hasRunsOn: typeof job['runs-on'] === 'string' || typeof job.uses === 'string' })
        .toEqual({ id, hasRunsOn: true });
      if (job.steps) {
        expect(Array.isArray(job.steps)).toBe(true);
        for (const step of job.steps) {
          expect({ id, step: step.name || step.uses, runOrUses: Boolean(step.run || step.uses) })
            .toEqual({ id, step: step.name || step.uses, runOrUses: true });
        }
      }
    }
  });
});
