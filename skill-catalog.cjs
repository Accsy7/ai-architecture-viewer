'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_CATALOG_SCHEMA_VERSION = '1.0.0';
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STAGES = new Set(['understand', 'plan', 'verify']);

class SkillCatalogError extends Error {
  constructor(message, code = 'SKILL_CATALOG_INVALID') {
    super(message);
    this.name = 'SkillCatalogError';
    this.code = code;
    this.status = 500;
  }
}

function assertText(value, valuePath, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new SkillCatalogError(`${valuePath} must be non-empty text`);
  }
}

function assertSafeRelative(value, valuePath) {
  assertText(value, valuePath, 500);
  if (
    value.includes('\\')
    || path.posix.isAbsolute(value)
    || /^[a-zA-Z]:/.test(value)
    || path.posix.normalize(value) !== value
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) throw new SkillCatalogError(`${valuePath} must be a safe relative path`);
}

function readSkillCatalog(skillsRoot = path.join(__dirname, 'skills')) {
  const root = path.resolve(skillsRoot);
  const manifestFile = path.join(root, 'manifest.json');
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new SkillCatalogError(`Unable to read skill catalog: ${error.message}`, 'SKILL_CATALOG_READ_FAILED');
  }
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new SkillCatalogError('Skill catalog must be an object');
  if (catalog.schemaVersion !== SKILL_CATALOG_SCHEMA_VERSION) throw new SkillCatalogError(`Skill catalog schemaVersion must be ${SKILL_CATALOG_SCHEMA_VERSION}`);
  if (catalog.protocolVersion !== '1.0.0') throw new SkillCatalogError('Skill catalog protocolVersion must be 1.0.0');
  if (!Array.isArray(catalog.skills) || !catalog.skills.length || catalog.skills.length > 20) throw new SkillCatalogError('Skill catalog must contain 1 to 20 skills');

  const ids = new Set();
  catalog.skills.forEach((skill, index) => {
    const skillPath = `skills[${index}]`;
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new SkillCatalogError(`${skillPath} must be an object`);
    const allowed = new Set(['id', 'displayName', 'stage', 'description', 'skillPath', 'outputs', 'defaultPrompt']);
    Object.keys(skill).forEach((key) => {
      if (!allowed.has(key)) throw new SkillCatalogError(`${skillPath}.${key} is not supported`);
    });
    if (typeof skill.id !== 'string' || !SKILL_ID.test(skill.id)) throw new SkillCatalogError(`${skillPath}.id is invalid`);
    if (ids.has(skill.id)) throw new SkillCatalogError(`Duplicate skill ID ${skill.id}`);
    ids.add(skill.id);
    assertText(skill.displayName, `${skillPath}.displayName`, 100);
    if (!STAGES.has(skill.stage)) throw new SkillCatalogError(`${skillPath}.stage is invalid`);
    assertText(skill.description, `${skillPath}.description`);
    assertSafeRelative(skill.skillPath, `${skillPath}.skillPath`);
    if (!Array.isArray(skill.outputs) || !skill.outputs.length || skill.outputs.length > 10) throw new SkillCatalogError(`${skillPath}.outputs is invalid`);
    skill.outputs.forEach((output, outputIndex) => assertSafeRelative(output, `${skillPath}.outputs[${outputIndex}]`));
    assertText(skill.defaultPrompt, `${skillPath}.defaultPrompt`, 4000);
    const instructionFile = path.resolve(root, skill.skillPath);
    if (!instructionFile.startsWith(`${root}${path.sep}`) || !fs.statSync(instructionFile).isFile()) {
      throw new SkillCatalogError(`${skillPath}.skillPath does not reference a bundled SKILL.md`);
    }
  });
  return JSON.parse(JSON.stringify(catalog));
}

module.exports = {
  SKILL_CATALOG_SCHEMA_VERSION,
  SkillCatalogError,
  readSkillCatalog,
};
