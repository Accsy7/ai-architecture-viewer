'use strict';

const path = require('path');
const { ContractError, clone } = require('./state-contract.cjs');

const CATALOG_SCHEMA_VERSION = '1.0.0';
const MAX_DIAGRAMS = 50;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const NODE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const RELATIVE_JSON_PATH = /^(?![a-zA-Z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+\.json$/i;

function requiredText(value, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ContractError(`架构目录 ${field} 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field });
  }
  return value.trim();
}

function optionalStableId(value, field, pattern = STABLE_ID) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ContractError(`架构目录 ${field} 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field });
  }
  return value;
}

function relativeJsonPath(value, field) {
  const normalized = requiredText(value, field, 260).replace(/\\/g, '/');
  if (normalized.includes('\0') || !RELATIVE_JSON_PATH.test(normalized)) {
    throw new ContractError(`架构目录 ${field} 必须是目录内的相对 JSON 路径`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field });
  }
  return normalized;
}

function navigationMetadata(value, field) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`架构目录 ${field} 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field });
  }
  const sectionOrder = Number(value.sectionOrder);
  const order = Number(value.order);
  if (!Number.isInteger(sectionOrder) || sectionOrder < 0 || sectionOrder > 999) {
    throw new ContractError(`架构目录 ${field}.sectionOrder 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field: `${field}.sectionOrder` });
  }
  if (!Number.isInteger(order) || order < 0 || order > 999) {
    throw new ContractError(`架构目录 ${field}.order 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field: `${field}.order` });
  }
  const sectionId = optionalStableId(value.sectionId, `${field}.sectionId`);
  if (!sectionId) {
    throw new ContractError(`架构目录 ${field}.sectionId 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field: `${field}.sectionId` });
  }
  return {
    sectionId,
    sectionLabel: requiredText(value.sectionLabel, `${field}.sectionLabel`, 80),
    sectionOrder,
    label: requiredText(value.label, `${field}.label`, 80),
    order,
    sectionRoot: Boolean(value.sectionRoot),
    menuVisible: value.menuVisible !== false,
  };
}

function validateArchitectureCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('架构目录必须是对象', 'ARCHITECTURE_CATALOG_INVALID', 500);
  }
  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new ContractError('架构目录版本无效', 'ARCHITECTURE_CATALOG_INVALID', 500, {
      expected: CATALOG_SCHEMA_VERSION,
      actual: raw.schemaVersion,
    });
  }
  if (!Array.isArray(raw.diagrams) || raw.diagrams.length < 1 || raw.diagrams.length > MAX_DIAGRAMS) {
    throw new ContractError(`架构目录 diagrams 必须包含 1 到 ${MAX_DIAGRAMS} 项`, 'ARCHITECTURE_CATALOG_INVALID', 500);
  }

  const seen = new Set();
  const diagrams = raw.diagrams.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContractError(`架构目录 diagrams[${index}] 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
    const id = optionalStableId(entry.id, `diagrams[${index}].id`);
    if (!id) throw new ContractError(`架构目录 diagrams[${index}].id 无效`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    if (seen.has(id)) throw new ContractError(`架构目录包含重复图谱 ${id}`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    seen.add(id);
    return {
      id,
      title: requiredText(entry.title, `diagrams[${index}].title`, 80),
      description: requiredText(entry.description, `diagrams[${index}].description`, 240),
      viewpoint: requiredText(entry.viewpoint, `diagrams[${index}].viewpoint`, 80),
      level: requiredText(entry.level, `diagrams[${index}].level`, 80),
      parentDiagramId: optionalStableId(entry.parentDiagramId, `diagrams[${index}].parentDiagramId`),
      ownerNodeId: optionalStableId(entry.ownerNodeId, `diagrams[${index}].ownerNodeId`, NODE_ID),
      defaultFocusNodeId: optionalStableId(entry.defaultFocusNodeId, `diagrams[${index}].defaultFocusNodeId`, NODE_ID),
      navigation: navigationMetadata(entry.navigation, `diagrams[${index}].navigation`),
      stateFile: relativeJsonPath(entry.stateFile, `diagrams[${index}].stateFile`),
      layoutFile: relativeJsonPath(entry.layoutFile, `diagrams[${index}].layoutFile`),
    };
  });

  const defaultDiagramId = optionalStableId(raw.defaultDiagramId, 'defaultDiagramId');
  if (!defaultDiagramId || !seen.has(defaultDiagramId)) {
    throw new ContractError('架构目录 defaultDiagramId 未指向有效图谱', 'ARCHITECTURE_CATALOG_INVALID', 500);
  }

  const byId = new Map(diagrams.map((entry) => [entry.id, entry]));
  diagrams.forEach((entry) => {
    if (entry.parentDiagramId && !byId.has(entry.parentDiagramId)) {
      throw new ContractError(`图谱 ${entry.id} 的父图谱不存在`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
    if (entry.parentDiagramId === entry.id) {
      throw new ContractError(`图谱 ${entry.id} 不能以自身为父图谱`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
    if (!entry.parentDiagramId && entry.ownerNodeId) {
      throw new ContractError(`顶层图谱 ${entry.id} 不能声明 ownerNodeId`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
  });

  const navigationSections = new Map();
  diagrams.forEach((entry) => {
    const navigation = entry.navigation;
    if (!navigation) return;
    const existing = navigationSections.get(navigation.sectionId);
    if (!existing) {
      navigationSections.set(navigation.sectionId, {
        label: navigation.sectionLabel,
        order: navigation.sectionOrder,
        roots: navigation.sectionRoot ? [entry] : [],
      });
      return;
    }
    if (existing.label !== navigation.sectionLabel || existing.order !== navigation.sectionOrder) {
      throw new ContractError(`导航层级 ${navigation.sectionId} 的名称或顺序不一致`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
    if (navigation.sectionRoot) existing.roots.push(entry);
  });
  navigationSections.forEach((section, sectionId) => {
    if (section.roots.length !== 1) {
      throw new ContractError(`导航层级 ${sectionId} 必须声明且只能声明一个根图`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
    if (!section.roots[0].navigation.menuVisible) {
      throw new ContractError(`导航层级 ${sectionId} 的根图必须显示在图菜单中`, 'ARCHITECTURE_CATALOG_INVALID', 500);
    }
  });

  diagrams.forEach((entry) => {
    const visited = new Set([entry.id]);
    let cursor = entry;
    while (cursor.parentDiagramId) {
      if (visited.has(cursor.parentDiagramId)) {
        throw new ContractError(`图谱 ${entry.id} 的层级形成循环`, 'ARCHITECTURE_CATALOG_INVALID', 500);
      }
      visited.add(cursor.parentDiagramId);
      cursor = byId.get(cursor.parentDiagramId);
    }
  });

  return { schemaVersion: CATALOG_SCHEMA_VERSION, defaultDiagramId, diagrams };
}

function ensureInsideCatalogRoot(catalogRoot, relativeFile, field) {
  const resolved = path.resolve(catalogRoot, relativeFile);
  const relative = path.relative(catalogRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ContractError(`架构目录 ${field} 越过目录边界`, 'ARCHITECTURE_CATALOG_INVALID', 500, { field });
  }
  return resolved;
}

function resolveArchitectureCatalog(raw, catalogFile) {
  const catalog = validateArchitectureCatalog(raw);
  const catalogRoot = path.dirname(path.resolve(catalogFile));
  return {
    ...catalog,
    diagrams: catalog.diagrams.map((entry) => ({
      ...entry,
      statePath: ensureInsideCatalogRoot(catalogRoot, entry.stateFile, `${entry.id}.stateFile`),
      layoutPath: ensureInsideCatalogRoot(catalogRoot, entry.layoutFile, `${entry.id}.layoutFile`),
    })),
  };
}

function createFallbackCatalog(stateFile, layoutFile) {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    defaultDiagramId: 'default',
    diagrams: [{
      id: 'default',
      title: '架构图',
      description: '当前项目的默认架构图',
      viewpoint: 'architecture',
      level: 'project',
      parentDiagramId: null,
      ownerNodeId: null,
      defaultFocusNodeId: null,
      navigation: {
        sectionId: 'default',
        sectionLabel: '架构图',
        sectionOrder: 0,
        label: '架构图',
        order: 0,
        sectionRoot: true,
        menuVisible: true,
      },
      stateFile: path.basename(stateFile),
      layoutFile: path.basename(layoutFile),
      statePath: path.resolve(stateFile),
      layoutPath: path.resolve(layoutFile),
    }],
  };
}

function publicArchitectureCatalog(catalog) {
  return {
    schemaVersion: catalog.schemaVersion,
    defaultDiagramId: catalog.defaultDiagramId,
    diagrams: catalog.diagrams.map((entry) => {
      const item = clone(entry);
      delete item.stateFile;
      delete item.layoutFile;
      delete item.statePath;
      delete item.layoutPath;
      return item;
    }),
  };
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  createFallbackCatalog,
  publicArchitectureCatalog,
  resolveArchitectureCatalog,
  validateArchitectureCatalog,
};
